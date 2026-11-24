import type {
  CommandInput as WireCommand, RouteResponse, createChangeVersionRoute, createQuoteVersionRoute,
} from "@bookbuddy/api-contract";
import { changeExpiresAt } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { withQuoteExpiry, withReviewDue } from "./deadlines";
import {
  actionableDecision, approvedTotal, bookedWork, canPublish, canReturn, canSubmit, commercialAccess,
  customer, decisionGrant, foreman, jobOpen, models, publicationCapacity, routing, versionFrom, versionVisible,
} from "./policy";
import type { CommercialKind } from "./policy";
import { versionProjection } from "./read";
import { commercialReceipt, revisionGuard } from "./receipts";
import { commercialSignals, mailIntent } from "./signals";
import type { CommercialEvent } from "./signals";

const actorScope = { sql: "SELECT * FROM commercial_actor" };
const candidate = "(SELECT id FROM commercial_input)";
const ceiling = Number.MAX_SAFE_INTEGER;
type QuoteDraft = RouteResponse<typeof createQuoteVersionRoute.input>["body"];
type ChangeDraft = RouteResponse<typeof createChangeVersionRoute.input>["body"];
type ReviewCommand = WireCommand<Record<never, never>>;
type ReturnCommand = WireCommand<{ reason: string }>;
type IssueCommand = WireCommand<{ termsHash: string }>;
type DecisionCommand = WireCommand<{ termsHash: string; readingArtifactRef?: string }>;
type VersionAction =
  | { action: "submit_review"; body: ReviewCommand }
  | { action: "return"; body: ReturnCommand }
  | { action: "issue"; body: IssueCommand }
  | { action: "approve" | "decline"; body: DecisionCommand };

function itemTotals(items: QuoteDraft["payload"]["items"] | ChangeDraft["payload"]["items"]) {
  let net = 0n, tax = 0n;
  for (const item of items) {
    net += BigInt(item.netMinor);
    tax += BigInt(item.taxMinor);
  }
  return { net: Number(net), tax: Number(tax), gross: Number(net + tax) };
}

function insertItems(kind: CommercialKind, id: string, items: QuoteDraft["payload"]["items"] | ChangeDraft["payload"]["items"], guard: CommandStatement) {
  return { sql: `INSERT INTO ${models[kind].items} (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule)
    SELECT ?, CAST(key AS INTEGER) + 1, value ->> 'originalLabel', value ->> 'quantity', value ->> 'netMinor',
      value ->> 'taxMinor', value ->> 'evidenceRule' FROM json_each(?) WHERE ${guard.sql}`,
  params: [id, JSON.stringify(items), ...guard.params ?? []] };
}

export function createVersion(ctx: RequestScope, session: SessionAccess, job: string,
  draft: { kind: "quote"; body: QuoteDraft } | { kind: "change"; body: ChangeDraft },
) {
  const { kind, body } = draft;
  const { id, termsVersionId, originalLocale, items, evidence } = body.payload;
  const { operationId, expectedRevision } = body;
  const amounts = itemTotals(items);
  // Media and reading-artifact migrations are later. Never persist an unchecked or dropped attachment.
  if (evidence.length || !Number.isSafeInteger(amounts.gross)) return null;
  const access = commercialAccess(session, ctx.now, job);
  const preconditions = `SELECT 1 FROM commercial_job j WHERE ${jobOpen} AND ${revisionGuard}
    AND j.site_zone IS NOT NULL AND j.named_approver_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM terms_versions t WHERE t.id = ? AND t.business_id = j.business_id)
    AND NOT EXISTS (SELECT 1 FROM ${models[kind].versions} WHERE id = ?)`;
  const guards = [expectedRevision ?? null, expectedRevision ?? null, termsVersionId, id];
  let eligible: CommandStatement;
  let insert: (guard: CommandStatement) => readonly CommandStatement[];
  if (draft.kind === "quote") {
    const { scope, exclusions } = draft.body.payload;
    const quoteId = crypto.randomUUID();
    eligible = { sql: `EXISTS (${preconditions} AND NOT EXISTS (SELECT 1 FROM quote_versions
      WHERE job_id = j.id AND state IN ('approved', 'in_review')))`, params: guards };
    insert = (guard) => [
      scopedStatement(access, `INSERT INTO quotes (id, job_id) SELECT ?, j.id FROM commercial_job j WHERE ${guard.sql}
        ON CONFLICT (job_id) DO NOTHING`, quoteId, ...guard.params ?? []),
      scopedStatement(access, `INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id,
        original_locale, scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
        SELECT ?, q.id, j.id, j.business_id, coalesce((SELECT max(no) FROM quote_versions WHERE quote_id = q.id), 0) + 1,
          actor.account_id, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'draft'
        FROM commercial_job j JOIN quotes q ON q.job_id = j.id CROSS JOIN commercial_actor actor WHERE ${guard.sql}`,
      id, termsVersionId, originalLocale, scope, exclusions, amounts.net, amounts.tax, amounts.gross, ...guard.params ?? []),
    ];
  } else {
    const { proposalId, baseQuoteVersionId, originalText, timing, affectedItems } = draft.body.payload;
    const derivedTotal = `${approvedTotal("?")} + ?`;
    eligible = { sql: `EXISTS (${preconditions} AND (${derivedTotal}) BETWEEN 0 AND ${ceiling}
      AND NOT EXISTS (SELECT 1 FROM change_proposals cp WHERE cp.id = ? AND (cp.job_id <> j.id OR cp.base_quote_version_id <> ?))
      AND NOT EXISTS (SELECT 1 FROM change_versions WHERE proposal_id = ? AND state IN ('approved', 'in_review')))`,
    params: [...guards, baseQuoteVersionId, amounts.gross, proposalId, baseQuoteVersionId, proposalId] };
    insert = (guard) => [
      scopedStatement(access, `INSERT INTO change_proposals (id, job_id, base_quote_version_id)
        SELECT ?, j.id, ? FROM commercial_job j WHERE ${guard.sql} AND NOT EXISTS (SELECT 1 FROM change_proposals WHERE id = ?)`,
      proposalId, baseQuoteVersionId, ...guard.params ?? [], proposalId),
      scopedStatement(access, `INSERT INTO change_versions (id, proposal_id, job_id, business_id, no, author_id, terms_id,
        original_locale, original_text, delta_minor, total_minor, timing, affected_items, state)
        SELECT ?, ?, j.id, j.business_id, coalesce((SELECT max(no) FROM change_versions WHERE proposal_id = ?), 0) + 1,
          actor.account_id, ?, ?, ?, ?, ${derivedTotal}, ?, ?, 'draft'
        FROM commercial_job j CROSS JOIN commercial_actor actor WHERE ${guard.sql}`,
      id, proposalId, proposalId, termsVersionId, originalLocale, originalText, amounts.gross, baseQuoteVersionId, amounts.gross,
      timing, affectedItems, ...guard.params ?? []),
    ];
  }
  return commercialReceipt(ctx, access, {
    access, scope: actorScope, operationId, command: `${kind}.create`, input: [job, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM commercial_job j WHERE ${foreman("scope")})` }, eligible,
    writes: (guard) => ({ statements: [...insert(guard), insertItems(kind, id, items, guard)] }),
  }, versionProjection(kind, id), expectedRevision);
}

export function transitionVersion(ctx: RequestScope, session: SessionAccess, kind: CommercialKind, id: string, command: VersionAction) {
  const { action, body } = command;
  const { operationId, expectedRevision } = body;
  const spec = models[kind];
  const access = commercialAccess(session, ctx.now, id, kind);
  const deciding = command.action === "approve" || command.action === "decline";
  const authorized = `scope.role ${deciding ? "= 'customer'" : "<> 'customer'"} AND EXISTS (
    SELECT 1 ${versionFrom(kind)} WHERE v.id = ${candidate} AND ${versionVisible(kind, "scope")})`;
  const checks: unknown[] = [expectedRevision ?? null, expectedRevision ?? null];
  const scoped = (condition: string) => `EXISTS (SELECT 1 ${versionFrom(kind)}
    WHERE v.id = ${candidate} AND ${revisionGuard} AND (${condition}))`;
  const exactTerms = "EXISTS (SELECT 1 FROM terms_versions t WHERE t.id = v.terms_id AND t.business_id = v.business_id AND t.hash = ?)";
  const versionUpdate = (guard: CommandStatement, fields: string, ...params: unknown[]) =>
    scopedStatement(access, `UPDATE ${spec.versions} SET ${fields} WHERE id = ${candidate} AND ${guard.sql}`,
      ...params, ...guard.params ?? []);
  let commandAccess = access;
  let condition: string;
  let event: CommercialEvent;
  let mutation: (guard: CommandStatement) => readonly CommandStatement[];
  let mail: CommandStatement | null = null;
  switch (command.action) {
    case "submit_review": {
      const reviewAccess = withReviewDue(access, ctx.now);
      commandAccess = { sql: `${reviewAccess.sql}, ${routing}`, params: reviewAccess.params };
      condition = `${canSubmit(kind, "scope")} AND (SELECT due_at FROM review_clock) > ${at}`;
      event = "commercial_review_due";
      const reviewId = crypto.randomUUID();
      mutation = (guard) => [
        scopedStatement(commandAccess, `INSERT INTO commercial_reviews (id, ${spec.ref}, reviewer_id, backup_id, submitted_at, due_at, state)
          SELECT ?, ${candidate}, reviewer_id, backup_id, ${at}, (SELECT due_at FROM review_clock), 'pending'
          FROM review_routing WHERE ${guard.sql}`, reviewId, ...guard.params ?? []),
        versionUpdate(guard, "state = 'in_review'"),
      ];
      break;
    }
    case "return": {
      const { reason } = command.body.payload;
      condition = canReturn("scope");
      event = "commercial_returned";
      mutation = (guard) => [
        scopedStatement(access, `UPDATE commercial_reviews SET state = 'returned', resolved_at = ${at},
          resolved_by_id = (SELECT account_id FROM commercial_actor), return_reason = ?
          WHERE ${spec.ref} = ${candidate} AND ${guard.sql}`, reason, ...guard.params ?? []),
        versionUpdate(guard, "state = 'returned'"),
      ];
      break;
    }
    case "issue": {
      let expires: CommandStatement;
      if (kind === "quote") {
        commandAccess = withQuoteExpiry(access, ctx.now);
        expires = { sql: "(SELECT expires_at FROM quote_clock)" };
      } else {
        const limit = changeExpiresAt(ctx.now, null);
        expires = { sql: `min(?, coalesce((SELECT min(w.starts_at) ${bookedWork} AND w.starts_at >= ${at}), ?))`, params: [limit, limit] };
      }
      const expirySql = kind === "quote" ? expires.sql : `(SELECT ${expires.sql} FROM commercial_job j)`;
      checks.push(command.body.payload.termsHash, ...expires.params ?? []);
      condition = `${canPublish(kind, "scope")} AND ${exactTerms} AND ${publicationCapacity} AND ${expirySql} > ${at}`;
      event = kind === "quote" ? "quote_ready" : "change_ready";
      mutation = (guard) => [
        scopedStatement(access, `UPDATE ${spec.versions} SET state = 'superseded' WHERE state = 'issued'
          AND ${spec.group} = (SELECT ${spec.group} FROM ${spec.versions} WHERE id = ${candidate}) AND ${guard.sql}`,
        ...guard.params ?? []),
        scopedStatement(commandAccess, `UPDATE ${spec.versions} SET state = 'issued', issued_at = ${at}, expires_at = ${expirySql},
          publisher_id = (SELECT account_id FROM commercial_actor) WHERE id = ${candidate} AND ${guard.sql}`,
        ...expires.params ?? [], ...guard.params ?? []),
        scopedStatement(access, `UPDATE commercial_reviews SET state = 'issued', resolved_at = ${at},
          resolved_by_id = (SELECT account_id FROM commercial_actor) WHERE ${spec.ref} = ${candidate} AND state = 'pending' AND ${guard.sql}`,
        ...guard.params ?? []),
      ];
      break;
    }
    case "approve": case "decline": {
      const { termsHash, readingArtifactRef } = command.body.payload;
      if (readingArtifactRef !== undefined) return null;
      const idOfDecision = crypto.randomUUID();
      checks.push(termsHash);
      condition = `${actionableDecision(kind, "scope")} AND ${exactTerms}`;
      event = action === "approve" ? "commercial_approved" : "commercial_declined";
      mutation = (guard) => [
        scopedStatement(access, `INSERT INTO approvals (id, ${spec.ref}, account_id, grant_id, terms_hash, decision, at)
          SELECT ?, ${candidate}, scope.account_id, (${decisionGrant("scope")}), ?, ?, ${at}
          FROM commercial_job j CROSS JOIN commercial_actor scope WHERE ${guard.sql}`,
        idOfDecision, termsHash, action, ...guard.params ?? []),
        versionUpdate(guard, "state = ?", action === "approve" ? "approved" : spec.declined),
      ];
      if (action === "approve") mail = mailIntent(`decision:${idOfDecision}`, `decision:${idOfDecision}`);
      break;
    }
  }
  return commercialReceipt(ctx, access, {
    access: commandAccess, scope: actorScope, operationId, command: `${kind}.${action}`, input: [id, body], resultRef: id,
    authorize: { sql: authorized }, eligible: { sql: scoped(condition), params: checks },
    writes: (guard) => {
      const { notifications, changes, effects } = commercialSignals(access, guard, kind, id, event, mail);
      return { statements: [...mutation(guard), ...notifications], changes, effects };
    },
  }, versionProjection(kind, id), expectedRevision);
}

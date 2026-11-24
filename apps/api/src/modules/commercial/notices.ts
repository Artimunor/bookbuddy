import type { RouteResponse, requestEarlyStartRoute, withdrawContractRoute } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { insideNoticePeriod, withSiteClock } from "./deadlines";
import { commercialAccess, customer, decisionGrant, jobOpen } from "./policy";
import { commercialReceipt, revisionGuard } from "./receipts";
import { commercialMailKind, mailIntent } from "./signals";

type EarlyStartBody = RouteResponse<typeof requestEarlyStartRoute.input>["body"];
type WithdrawalBody = RouteResponse<typeof withdrawContractRoute.input>["body"];
type NoticeCommand = { action: "early_start"; body: EarlyStartBody } | { action: "withdrawal"; body: WithdrawalBody };

// An explicit back-office flag opts an exact immutable terms version into the
// reviewed 14-calendar-day consumer policy. Do not infer rights or exclusions
// from a price, job origin, started visit, or the contents of legal prose.
const termsPolicy = "commercial_consumer_distance_14_day";
const request = "early_start_request";
const acknowledgement = "early_start_acknowledgement";
const noticeMailKey = "notice";
const receiptFields = `'id', n.id, 'jobId', n.job_id, 'quoteVersionId', n.quote_version_id,
  'termsHash', n.terms_hash, 'kind', n.kind, 'actorDisplayName', ${displayName("a")}, 'at', n.at`;

export function readContractNotices(session: SessionAccess, now: number, job: string): CommandStatement {
  const access = commercialAccess(session, now, job);
  // Withdrawal keeps the actual submitted statement. The early-start
  // receipts derive their wording from the original immutable terms.
  return scopedStatement(access, `SELECT (
    SELECT (SELECT json_object('notices', json_group_array(json(receipt))) FROM (
      SELECT json_object(${receiptFields}, 'noticeText', coalesce(n.notice_text, CASE n.kind
        WHEN '${acknowledgement}' THEN t.consent_text ELSE t.original_text END),
        'noticeLocale', coalesce(n.notice_locale, t.contract_locale),
        'termsText', t.original_text, 'termsLocale', t.contract_locale, 'deliveryState', e.state) AS receipt
      FROM contract_notices n JOIN accounts a ON a.id = n.account_id
      JOIN quote_versions v ON v.id = n.quote_version_id AND v.job_id = n.job_id
      JOIN terms_versions t ON t.id = v.terms_id AND t.business_id = j.business_id AND t.hash = n.terms_hash
      LEFT JOIN effect_outbox e ON e.dedupe_key = '${commercialMailKind}:${noticeMailKey}:' || n.id
      WHERE n.job_id = j.id AND n.account_id = scope.account_id
      ORDER BY n.at DESC, n.id DESC
    )) FROM commercial_job j CROSS JOIN commercial_actor scope
    WHERE ${customer("scope")} AND EXISTS (${decisionGrant("scope")})
  ) AS value FROM acting_session`);
}

function noticeProjection(quoteId: string, action: NoticeCommand["action"], acknowledge: boolean): CommandStatement {
  const notice = `SELECT json_object(${receiptFields})
    FROM contract_notices n JOIN accounts a ON a.id = n.account_id
    WHERE n.job_id = j.id AND n.quote_version_id = ? AND n.account_id = scope.account_id AND n.kind =`;
  return action === "withdrawal" ? { sql: `${notice} 'withdrawal'`, params: [quoteId] }
    : { sql: `SELECT json_object('request', json((${notice} '${request}')),
      'acknowledgement', ${acknowledge ? `json((${notice} '${acknowledgement}'))` : "NULL"})`,
      params: acknowledge ? [quoteId, quoteId] : [quoteId] };
}

export function recordContractNotice(ctx: RequestScope, session: SessionAccess, job: string, command: NoticeCommand) {
  const { action, body: { operationId, payload, expectedRevision } } = command;
  const { quoteVersionId, termsHash } = payload;
  const acknowledge = command.action === "early_start" && command.body.payload.acknowledgement === true;
  const statement = command.action === "withdrawal" ? command.body.payload : null;
  const primaryKind = action === "early_start" ? request : action;
  const primaryId = crypto.randomUUID();
  const ackId = acknowledge ? crypto.randomUUID() : null;
  const access = commercialAccess(session, ctx.now, job);
  const notRecorded = (kind: string) => `NOT EXISTS (SELECT 1 FROM contract_notices n
    WHERE n.quote_version_id = v.id AND n.kind = '${kind}')`;
  const entitled = `EXISTS (SELECT 1 FROM commercial_job j JOIN quote_versions v ON v.job_id = j.id
    JOIN approvals a ON a.quote_version_id = v.id AND a.decision = 'approve' AND a.account_id = scope.account_id
    WHERE v.id = ? AND ${customer("scope")} AND EXISTS (${decisionGrant("scope")}))`;
  const eligible = `EXISTS (SELECT 1 FROM commercial_job j JOIN quote_versions v ON v.job_id = j.id
    JOIN terms_versions t ON t.id = v.terms_id AND t.business_id = j.business_id
    JOIN approvals a ON a.quote_version_id = v.id AND a.decision = 'approve' AND a.account_id = scope.account_id
    WHERE v.id = ? AND v.state = 'approved' AND a.at <= ${at} AND a.terms_hash = t.hash AND t.hash = ? AND ${revisionGuard}
    AND EXISTS (SELECT 1 FROM feature_flags policy WHERE policy.key = '${termsPolicy}' AND policy.scope_key = t.id AND policy.enabled = 1)
    AND ${insideNoticePeriod} AND ${notRecorded("withdrawal")}${action === "early_start"
      ? ` AND ${jobOpen} AND ${notRecorded(acknowledge ? acknowledgement : request)}` : ""})`;
  return commercialReceipt(ctx, access, {
    access: withSiteClock(access, ctx.now), scope: { sql: "SELECT * FROM commercial_actor" }, operationId,
    command: `contract.${action}`, input: [job, command.body], resultRef: ackId ?? primaryId,
    authorize: { sql: entitled, params: [quoteVersionId] },
    eligible: { sql: eligible, params: [quoteVersionId, termsHash, expectedRevision ?? null, expectedRevision ?? null] },
    writes: (guard) => {
      const insert = (kind: string, id: string) => scopedStatement(access, `INSERT INTO contract_notices
        (id, job_id, quote_version_id, account_id, terms_hash, kind, at, notice_text, notice_locale)
        SELECT ?, j.id, ?, scope.account_id, ?, ?, ${at}, ?, ? FROM commercial_job j CROSS JOIN commercial_actor scope
        WHERE ${guard.sql} AND NOT EXISTS (SELECT 1 FROM contract_notices WHERE quote_version_id = ? AND kind = ?)`,
      id, quoteVersionId, termsHash, kind, statement?.noticeText ?? null, statement?.noticeLocale ?? null,
      ...guard.params ?? [], quoteVersionId, kind);
      const states = [primaryId, ...(ackId ? [ackId] : [])];
      const mail = mailIntent(noticeMailKey, noticeMailKey);
      const statements = [insert(primaryKind, primaryId)];
      if (ackId) statements.push(insert(acknowledgement, ackId));
      return { statements, effects: scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, m.kind,
        m.dedupe_key || ':' || n.id AS dedupe_key, m.resource_ref || ':' || n.id AS resource_ref, m.due_at, m.expires_at
        FROM (${mail.sql}) m CROSS JOIN contract_notices n
        WHERE n.id IN (SELECT value FROM json_each(?))`, ...mail.params ?? [], JSON.stringify(states)) };
    },
  }, noticeProjection(quoteVersionId, action, acknowledge), expectedRevision);
}

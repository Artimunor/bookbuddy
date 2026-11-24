import type { CommandStatement } from "../../db/commit";
import { at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import {
  actionableDecision, availableWindows, canPublish, canReturn, canSubmit, commercialAccess, customer, foreman,
  hasRouting, jobOpen, models, newest, noApproved, publicationCapacity, routedReviewer, routing, versionAudience,
  versionFrom, versionVisible,
} from "./policy";
import type { CommercialKind } from "./policy";

const pageSize = 50;
const name = (accountId: string) => `(SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${accountId})`;
const bool = (expression: string) => `json(CASE WHEN (${expression}) THEN 'true' ELSE 'false' END)`;
const originalOnly = "json_object('status', 'original_only')";
const displayedState = `CASE WHEN v.state = 'issued' AND v.expires_at <= ${at} THEN 'expired' ELSE v.state END`;
const publication = `'publisherDisplayName', ${name("v.publisher_id")}, 'issuedAt', v.issued_at, 'expiresAt', v.expires_at`;

function summary(kind: CommercialKind): string {
  const group = kind === "quote" ? "'quoteId', v.quote_id" : `'proposalId', v.proposal_id, 'deltaMinor', v.delta_minor,
    'baseQuoteVersionId', (SELECT base_quote_version_id FROM change_proposals WHERE id = v.proposal_id)`;
  return `'id', v.id, ${group}, 'no', v.no, 'state', ${displayedState}, 'totalMinor', v.total_minor,
    'currency', 'EUR', ${publication}`;
}

const terms = `SELECT json_object('id', t.id, 'version', t.version, 'providerLegalSnapshot', t.provider_legal_snapshot,
    'originalText', t.original_text, 'contractLocale', t.contract_locale, 'consentText', t.consent_text, 'hash', t.hash)
  FROM terms_versions t WHERE t.id = v.terms_id AND t.business_id = v.business_id`;
const jobHeader = `json_object('jobId', j.id, 'reference', j.reference, 'jobTitle', coalesce(nullif(j.trade, ''), j.reference),
  'placeAlias', j.alias, 'siteZone', j.site_zone, 'providerDisplayName', j.public_name,
  'namedApproverDisplayName', ${name("j.named_approver_id")})`;
const decisionJson = `json_object('id', a.id, 'decision', a.decision, 'termsHash', a.terms_hash,
  'actorDisplayName', ${name("a.account_id")}, 'at', a.at)`;

function content(kind: CommercialKind): string {
  const field = kind === "quote" ? `'scope', v.scope, 'exclusions', v.exclusions, 'netMinor', v.net_minor, 'taxMinor', v.tax_minor`
    : `'originalText', v.original_text, 'timing', v.timing, 'affectedItems', v.affected_items,
      'approvedBase', json((SELECT json_object('id', q.id, 'no', q.no, 'totalMinor', q.total_minor,
        'currency', q.currency, 'originalLocale', q.original_locale, 'scope', q.scope, 'exclusions', q.exclusions,
        'readingAid', ${originalOnly}, 'approval', ${decisionJson}) FROM change_proposals cp
        JOIN quote_versions q ON q.id = cp.base_quote_version_id AND q.job_id = v.job_id
        JOIN approvals a ON a.quote_version_id = q.id AND a.decision = 'approve' WHERE cp.id = v.proposal_id))`;
  return `${field}, 'originalLocale', v.original_locale, 'readingAid', ${originalOnly}, 'evidence', json_array(),
    'terms', json((${terms})), 'items', json((SELECT json_group_array(json_object('lineNo', line_no,
      'originalLabel', original_label, 'quantity', quantity, 'netMinor', net_minor, 'taxMinor', tax_minor,
      'evidenceRule', evidence_rule)) FROM (SELECT line_no, original_label, quantity, net_minor, tax_minor, evidence_rule
      FROM ${models[kind].items} WHERE version_id = v.id ORDER BY line_no)))`;
}

const reviewNames = (r: string) => `'reviewerDisplayName', ${name(`${r}.reviewer_id`)}, 'backupDisplayName', ${name(`${r}.backup_id`)}`;
const reviewPayload = `CASE WHEN review.id IS NOT NULL THEN json_object('id', review.id, ${reviewNames("review")},
  'state', review.state, 'submittedAt', review.submitted_at, 'dueAt', review.due_at, 'returnReason', review.return_reason,
  'resolvedAt', review.resolved_at, 'resolvedByDisplayName', ${name("review.resolved_by_id")}) END`;

function detail(kind: CommercialKind, audience: "customer" | "staff"): string {
  const spec = models[kind];
  const fields = audience === "customer" ? `'audience', 'customer',
    'viewerIsNamedApprover', ${bool("j.named_approver_id = scope.account_id AND EXISTS (" + decisionGrantSql + ")")},
    'actions', json((SELECT json_object('approve', json(enabled), 'decline', json(enabled))
      FROM (SELECT CASE WHEN (${actionableDecision(kind, "scope")}) THEN 'true' ELSE 'false' END AS enabled)))
    ${kind === "quote" ? `, 'hasProposedWindows', ${bool(availableWindows)}` : ""}`
    : `'audience', ${versionAudience("scope")}, 'authorDisplayName', ${name("v.author_id")},
      'reviewRouting', json(CASE WHEN review.id IS NOT NULL THEN json_object(${reviewNames("review")})
        WHEN ${hasRouting("v.author_id")} THEN (SELECT json_object(${reviewNames("route")}) FROM review_routing route) END),
      'review', json(${reviewPayload}), 'actions', json_object(
        'createRevision', ${bool(`${jobOpen} AND ${foreman("scope")} AND ${newest(kind)} AND ${noApproved(kind)}`)},
        'submitReview', ${bool(canSubmit(kind, "scope"))}, 'return', ${bool(canReturn("scope"))},
        'issue', ${bool(`${canPublish(kind, "scope")} AND ${publicationCapacity}`)})`;
  return `json_object(${fields}, ${summary(kind)}, 'job', ${jobHeader}, ${content(kind)},
    'decision', json((SELECT ${decisionJson} FROM approvals a WHERE a.${spec.ref} = v.id)),
    'replacedBy', json(CASE WHEN v.state = 'superseded' THEN (SELECT json_object('id', next.id, 'no', next.no, 'issuedAt', next.issued_at)
      FROM ${spec.versions} next WHERE next.${spec.group} = v.${spec.group} AND next.no > v.no AND next.issued_at <= ${at}
      ORDER BY next.no DESC LIMIT 1) END))`;
}

const decisionGrantSql = `SELECT 1 FROM place_grants g WHERE g.place_id = j.place_id AND g.account_id = scope.account_id
  AND g.capability = 'approve' AND g.revoked_at IS NULL AND g.valid_from <= ${at} AND (g.valid_until IS NULL OR g.valid_until > ${at})`;

export function versionProjection(kind: CommercialKind, id: string): CommandStatement {
  return { sql: `SELECT CASE WHEN scope.role = 'customer' THEN ${detail(kind, "customer")} ELSE ${detail(kind, "staff")} END
    ${versionFrom(kind)} WHERE v.id = ? AND ${versionVisible(kind, "scope")}`, params: [id] };
}

export function readVersion(session: SessionAccess, now: number, kind: CommercialKind, job: string, id: string): CommandStatement {
  const access = commercialAccess(session, now, job);
  const projection = versionProjection(kind, id);
  return scopedStatement(access, `, ${routing}
    SELECT (SELECT (${projection.sql}) FROM commercial_actor scope) AS value FROM acting_session`, ...projection.params!);
}

export function readVersionList(session: SessionAccess, now: number, kind: CommercialKind, job: string, cursor?: string): CommandStatement | null {
  const position = cursor && /^(\d+)~([A-Za-z0-9_-]{1,256})$/.exec(cursor);
  if (cursor && (!position || !Number.isSafeInteger(Number(position[1])) || Number(position[1]) < 1)) return null;
  const access = commercialAccess(session, now, job);
  return scopedStatement(access, `, scoped_job AS MATERIALIZED (
    SELECT CASE WHEN scope.role = 'customer' THEN 'customer' WHEN ${foreman("scope")} THEN 'foreman' ELSE 'reviewer' END AS audience,
      CASE WHEN ${foreman("scope")} THEN (
        SELECT json_object('id', t.id, 'version', t.version) FROM terms_versions t
        WHERE t.business_id = j.business_id ORDER BY t.version DESC, t.id DESC LIMIT 1
      ) END AS current_terms
    FROM commercial_job j CROSS JOIN commercial_actor scope WHERE ${customer("scope")} OR ${foreman("scope")} OR EXISTS (
      SELECT 1 FROM ${models[kind].versions} v JOIN commercial_reviews review ON review.${models[kind].ref} = v.id
      WHERE v.job_id = j.id AND ${routedReviewer("scope", "review")})
  ), version_list AS (
    SELECT audience, current_terms, json_object('audience', audience, 'versions', json((SELECT json_group_array(json(summary)) FROM (
      SELECT json_object(${summary(kind)}) AS summary ${versionFrom(kind)} CROSS JOIN commercial_actor scope
      WHERE ${versionVisible(kind, "scope")} AND (v.no, v.id) < (?, ?)
      ORDER BY v.no DESC, v.id DESC LIMIT ${pageSize + 1})))) AS value FROM scoped_job
  ) SELECT (SELECT CASE WHEN audience = 'foreman' THEN json_set(value, '$.currentTerms', json(current_terms)) ELSE value END
    FROM version_list) AS value FROM acting_session`,
  position ? Number(position[1]) : Number.MAX_SAFE_INTEGER, position ? position[2]! : "~");
}

export function decodeVersionList(value: string): unknown {
  const packet = JSON.parse(value) as { audience: string; versions: { no: number; id: string }[] };
  const hasMore = packet.versions.length > pageSize;
  if (hasMore) packet.versions.pop();
  const last = hasMore ? packet.versions.at(-1)! : null;
  return { ...packet, hasMore, cursor: last ? `${last.no}~${last.id}` : null };
}

import type { RouteResponse, appendCaseEventRoute, getProblemCaseRoute, listJobCasesRoute, submitProblemCaseRoute } from "@bookbuddy/api-contract";
import { AFTERCARE_TARGETS } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import { recordEffectIntents } from "../../db/operations";
import type { OperationWrites } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, liveTerm, scopedStatement } from "../access/policy";
import { liveContextPredicate } from "../auth/session";
import type { SessionAccess } from "../auth/session";
import { customer } from "../commercial/policy";
import { currentMembership } from "../jobs/projections";
import { createLinkTarget, linkTokenFor, registerLinkResolver } from "../links";
import type { LinkResolver } from "../links";
import { createLinkedNotifications } from "../links/notifications";
import { placeCapability } from "../places/policy";
import { aftercareAccess, aftercareJobValue, aftercareReceipt, authored, dayMs, jobSource, nameOf, withAftercareSiteClock } from "./completion";

type ReadCase = RouteResponse<typeof getProblemCaseRoute.input>;
type ListCases = RouteResponse<typeof listJobCasesRoute.input>;
type SubmitCase = RouteResponse<typeof submitProblemCaseRoute.input>;
type AppendEvent = RouteResponse<typeof appendCaseEventRoute.input>;
const pageSize = 50;
const caseId = "(SELECT id FROM case_input)";
const eventId = "(SELECT event_id FROM case_input)";
const revisionMatches = "((SELECT revision FROM case_input) IS NULL OR j.revision = (SELECT revision FROM case_input))";
const activeCase = "pc.state IN ('open', 'awaiting_plan')";
const reporter = (s: string) => `(${customer(s)} AND pc.reporter_id = ${s}.account_id)`;
const owner = (s: string) => `(${s}.role = 'customer' AND pc.case_owner_id = ${s}.account_id)`;
const caseGrant = (s: string) => `(${s}.role IN ('provider_admin', 'foreman') AND ${s}.business_id = j.business_id
  AND ${s}.membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM case_grants g WHERE g.case_id = pc.id
    AND g.context_id = ${s}.context_id AND g.capability = pc.provider_audience AND ${liveTerm("g")}))`;
export const mayReadCase = (s: string) => `(${reporter(s)} OR ${owner(s)} OR ${caseGrant(s)})`;
const mayReport = (s: string) => `(${customer(s)} AND (${s}.account_id IN (j.owner_id, j.requester_id)
  OR ${placeCapability("j.place_id", `${s}.account_id`, "book")} OR ${placeCapability("j.place_id", `${s}.account_id`, "approve")}) )`;
const packetExists = `EXISTS (SELECT 1 FROM case_events p WHERE p.case_id = pc.id AND p.kind = 'provider_packet' AND p.audience = pc.provider_audience)`;
export const mayUseCasePacket = (s: string) => `(${caseGrant(s)} AND ${packetExists})`;
const flag = (condition: string) => `json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;
const rows = (sql: string) => `(SELECT json_group_array(json(value)) FROM (${sql}))`;
const receipt = `json_object('id', pc.id, 'reference', pc.reference, 'state', pc.state, 'category', pc.category,
  'openedAt', pc.opened_at, 'caseOwnerDisplayName', ${nameOf("pc.case_owner_id")}, 'acknowledgeBy', pc.acknowledge_by,
  'firstUpdateBy', pc.first_update_by, 'nextUpdateAt', pc.next_update_at)`;
const signOff = `(SELECT json_object('id', s.id, 'completionId', c.id, 'completionVersion', c.no,
  'quoteVersionId', c.base_quote_version_id, 'termsHash', s.terms_hash, 'at', s.at, 'actorDisplayName', ${nameOf("s.approver_id")})
  FROM sign_offs s JOIN completions c ON c.id = s.completion_id WHERE s.job_id = j.id AND s.at <= ${at})`;
const image = "a.mime GLOB 'image/*'";
const voice = "a.mime GLOB 'audio/*'";
const available = `a.state = 'ready' AND (a.delete_after IS NULL OR a.delete_after > ${at})`;
const eventValue = `json_object('id', e.id, 'kind', e.kind, 'at', e.at, 'actorDisplayName', ${nameOf("e.actor_id")},
  'content', json(${authored("e.original_text", "e.original_language")}), 'evidence', json(${rows(`SELECT CASE WHEN ${image}
    THEN json_object('kind', 'photo', 'attachmentId', a.id, 'availability', CASE WHEN ${available} THEN 'available' ELSE 'unavailable' END,
      'capturedAt', NULL, 'caption', NULL)
    ELSE json_object('kind', 'voice', 'attachmentId', a.id, 'availability', CASE WHEN ${available} THEN 'available' ELSE 'unavailable' END,
      'durationMs', a.duration_ms) END AS value
  FROM case_attachments link JOIN attachments a ON a.id = link.attachment_id
  WHERE link.case_id = e.case_id AND link.case_event_id = e.id ORDER BY a.id`)}))`;
const scopeLine = `(SELECT json_object('ref', json_object('kind', 'quote', 'quoteVersionId', pc.quote_version_id, 'lineNo', pc.line_no),
      'label', json(${authored("i.original_label", "q.original_locale")}), 'evidenceRule', i.evidence_rule, 'evidenceAlternative', i.evidence_alternative)
    FROM quote_items i JOIN quote_versions q ON q.id = i.version_id WHERE i.version_id = pc.quote_version_id AND i.line_no = pc.line_no
    UNION ALL SELECT json_object('ref', json_object('kind', 'change', 'changeVersionId', pc.change_version_id, 'lineNo', pc.line_no),
      'label', json(${authored("i.original_label", "v.original_locale")}), 'evidenceRule', i.evidence_rule, 'evidenceAlternative', i.evidence_alternative)
    FROM change_items i JOIN change_versions v ON v.id = i.version_id WHERE i.version_id = pc.change_version_id AND i.line_no = pc.line_no)`;

const cursorAt = "(SELECT stamp FROM case_page_input)";
const cursorId = "(SELECT id FROM case_page_input)";
const pageAfter = (time: string, id: string) => `(${cursorAt} IS NULL OR (${time}, ${id}) < (${cursorAt}, ${cursorId}))`;
const pageInfo = `json_object('hasMore', ${flag(`(SELECT count(*) FROM page_rows) > ${pageSize}`)}, 'cursor',
  CASE WHEN (SELECT count(*) FROM page_rows) > ${pageSize} THEN (SELECT stamp || '~' || id FROM shown ORDER BY stamp, id LIMIT 1) END)`;
function pagePosition(cursor: string | undefined): [number | null, string | null] | null {
  if (cursor === undefined) return [null, null];
  const match = /^(-?\d+)~([A-Za-z0-9_-]{1,256})$/.exec(cursor);
  return match && Number.isSafeInteger(Number(match[1])) ? [Number(match[1]), match[2]!] : null;
}

function caseValue(s: string, useCursor = false): string {
  const participant = "(SELECT kind FROM audience) IN ('reporter', 'case_owner')";
  const timeline = (condition: string) => rows(`SELECT CASE WHEN e.kind = 'correction_requested'
    THEN json_set(${eventValue}, '$.completionId', e.completion_id) ELSE ${eventValue} END AS value
    FROM shown e WHERE ${condition} ORDER BY e.stamp DESC, e.id DESC`);
  return `(WITH audience AS MATERIALIZED (SELECT CASE WHEN ${reporter(s)} THEN 'reporter' WHEN ${owner(s)} THEN 'case_owner'
    ELSE pc.provider_audience END AS kind), page_rows AS MATERIALIZED (
      SELECT e.*, e.at AS stamp FROM case_events e WHERE e.case_id = pc.id AND e.at <= ${at} AND e.kind <> 'reported'
        AND CASE WHEN ${participant} THEN e.audience = 'reporter_and_owner'
          ELSE e.audience = pc.provider_audience OR (e.kind = 'substantive_update' AND e.actor_id = ${s}.account_id) END
        ${useCursor ? `AND ${pageAfter("e.at", "e.id")}` : ""} ORDER BY e.at DESC, e.id DESC LIMIT ${pageSize + 1}
    ), shown AS MATERIALIZED (SELECT * FROM page_rows ORDER BY stamp DESC, id DESC LIMIT ${pageSize})
    SELECT CASE WHEN ${participant} THEN json_object('audience', (SELECT kind FROM audience), 'job', ${aftercareJobValue},
      'receipt', ${receipt}, 'disclosedProviderAudience', pc.provider_audience,
      'affectedItem', json(${scopeLine}), 'bill', json((SELECT json_object('id', b.id, 'number', b.number) FROM bills b WHERE b.id = pc.bill_id)),
      'signOff', json(${signOff}), 'report', json((SELECT ${eventValue} FROM case_events e WHERE e.case_id = pc.id AND e.kind = 'reported')),
      'history', json(${timeline("1")}), 'page', ${pageInfo}, 'actions', json_object(
        'appendReport', ${flag(`${reporter(s)} AND ${activeCase}`)}, 'reviewCompletion', ${flag(`${reporter(s)} AND pc.state IN ('resolved', 'closed')
           AND EXISTS (SELECT 1 FROM completions c WHERE c.job_id = j.id AND c.state = 'submitted')`)}))
    ELSE json_object('audience', (SELECT kind FROM audience), 'job', json_object('jobId', j.id, 'reference', j.reference, 'siteZone', j.site_zone),
      'receipt', ${receipt}, 'packets', json(${timeline("e.kind = 'provider_packet'")}), 'replies', json(${timeline("e.kind = 'substantive_update'")}),
      'page', ${pageInfo}, 'canRespond', ${flag(`${activeCase} AND ${packetExists}`)}) END)`;
}

function caseAccess(session: SessionAccess, now: number, id: string, event: string | null, revision?: number, jobId?: string): SessionAccess {
  const base = jobId === undefined ? accessClock(session, now) : aftercareAccess(session, now, jobId);
  return { sql: `${base.sql}, case_input(id, event_id, revision) AS (VALUES (?, ?, ?))${jobId === undefined ? `,
    aftercare_job AS MATERIALIZED (${jobSource(`j.id = (SELECT job_id FROM problem_cases WHERE id = ${caseId})`)}),
    aftercare_actor AS MATERIALIZED (SELECT s.*, ${currentMembership("s", at)} AS membership_id FROM live_scope s)` : ""}`,
  params: [...base.params, id, event, revision ?? null] };
}
const caseProjection = (s: string, id: string, paged = false) => `(SELECT ${caseValue(s, paged)} FROM problem_cases pc
  WHERE pc.id = ${id} AND pc.job_id = j.id AND pc.opened_at <= ${at} AND ${mayReadCase(s)})`;

export function readProblemCase(session: SessionAccess, now: number, { params, query }: ReadCase) {
  const position = pagePosition(query?.cursor);
  if (!position) return null;
  const access = caseAccess(session, now, params.id, null);
  return scopedStatement(access, `, case_page_input(stamp, id) AS (VALUES (?, ?))
    SELECT (SELECT ${caseProjection("scope", caseId, true)} FROM aftercare_job j CROSS JOIN aftercare_actor scope) AS value FROM acting_session`, ...position);
}

export function readJobCases(session: SessionAccess, now: number, { params, query }: ListCases) {
  const position = pagePosition(query?.cursor);
  if (!position) return null;
  const access = aftercareAccess(session, now, params.j);
  return scopedStatement(access, `, opening(category) AS (VALUES (?)), ${providerRouting},
  case_page_input(stamp, id) AS (VALUES (?, ?)), page_rows AS MATERIALIZED (
    SELECT pc.*, pc.opened_at AS stamp FROM aftercare_job j CROSS JOIN aftercare_actor scope
    JOIN problem_cases pc ON pc.job_id = j.id WHERE pc.opened_at <= ${at} AND ${mayReadCase("scope")}
      AND ${pageAfter("pc.opened_at", "pc.id")} ORDER BY pc.opened_at DESC, pc.id DESC LIMIT ${pageSize + 1}
  ), shown AS MATERIALIZED (SELECT * FROM page_rows ORDER BY stamp DESC, id DESC LIMIT ${pageSize})
  SELECT (SELECT json_object('jobId', j.id, 'siteZone', j.site_zone,
    'cases', json(${rows(`SELECT ${receipt} AS value FROM shown pc ORDER BY pc.stamp DESC, pc.id DESC`)}), 'page', ${pageInfo},
    'newCaseAudience', json(CASE WHEN ${mayReport("scope")} AND EXISTS (SELECT 1 FROM case_route r
      WHERE r.audience <> 'provider_billing' OR ${placeCapability("j.place_id", "scope.account_id", "bill_view")})
    THEN json_object('businessId', j.business_id, 'providerName', j.public_name) END))
    FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${mayReport("scope")} OR EXISTS (
      SELECT 1 FROM problem_cases pc WHERE pc.job_id = j.id AND pc.opened_at <= ${at} AND ${mayReadCase("scope")})) AS value FROM acting_session`,
  query?.category ?? null, ...position);
}

// Count staffed local dates, honoring date overrides (including holidays) and
// repeated/missing wall times. The current site's calendar is selected in D1.
function withBusinessTargets(access: SessionAccess, now: number): SessionAccess {
  const clock = withAftercareSiteClock(access, now);
  return { ...clock, sql: `${clock.sql}, day_numbers(day) AS (
    VALUES (1) UNION ALL SELECT day + 1 FROM day_numbers WHERE day < 28
  ), business_dates AS MATERIALIZED (
    SELECT d.day, ${at} + current.offset_ms + d.day * ${dayMs} AS wall_due, coalesce(p.area_id, b.catchment_id) AS area_id
    FROM aftercare_job j JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
    JOIN site_clock current ON ${at} >= current.starts AND ${at} < current.ends CROSS JOIN day_numbers d
  ), staffed_dates AS (
    SELECT wall_due, row_number() OVER (ORDER BY day) AS no FROM business_dates d
    LEFT JOIN staffed_calendar h ON h.area_id = d.area_id AND h.local_date = date(d.wall_due / 1000, 'unixepoch')
    LEFT JOIN staffed_calendar w ON w.area_id = d.area_id AND w.weekday = (CAST(strftime('%w', d.wall_due / 1000, 'unixepoch') AS INTEGER) + 6) % 7 + 1
    WHERE CASE WHEN h.id IS NOT NULL THEN h.opens_minute IS NOT NULL
      WHEN EXISTS (SELECT 1 FROM staffed_calendar cfg WHERE cfg.area_id = d.area_id AND cfg.weekday IS NOT NULL) THEN w.id IS NOT NULL
      ELSE strftime('%w', d.wall_due / 1000, 'unixepoch') NOT IN ('0', '6') END
    ORDER BY day LIMIT ${Math.max(AFTERCARE_TARGETS.caseAcknowledgementBusinessDays, AFTERCARE_TARGETS.caseFirstUpdateBusinessDays, AFTERCARE_TARGETS.caseNextUpdateBusinessDays)}
  ), case_targets AS MATERIALIZED (
    SELECT d.no, min(max(s.starts, d.wall_due - s.offset_ms)) AS due FROM staffed_dates d CROSS JOIN site_clock s
    WHERE max(s.starts, d.wall_due - s.offset_ms) < s.ends GROUP BY d.no
  )` };
}
const deadline = (day: number) => `(SELECT due FROM case_targets WHERE no = ${day})`;
const ackDeadline = deadline(AFTERCARE_TARGETS.caseAcknowledgementBusinessDays);
const firstDeadline = deadline(AFTERCARE_TARGETS.caseFirstUpdateBusinessDays);
const nextDeadline = deadline(AFTERCARE_TARGETS.caseNextUpdateBusinessDays);

const caseOpened = "case_opened";
const caseUpdate = "case_updated";
const providerPacket = "case_provider_packet";
const ackDue = "case_acknowledgement_due";
const updateDue = "case_update_due";
const noticeExpiry = `${at} + ${7 * dayMs}`;
const caseLink: LinkResolver = {
  targetKind: "problem_case",
  project(resource, s) {
    return `(SELECT json_object('kind', 'problem_case', 'case', json(${caseProjection(s, resource)}))
      FROM (${jobSource(`j.id = (SELECT job_id FROM problem_cases WHERE id = ${resource})`)}) j
      WHERE EXISTS (SELECT 1 FROM problem_cases pc WHERE pc.id = ${resource} AND ${mayReadCase(s)}))`;
  },
};
for (const kind of [caseOpened, caseUpdate, providerPacket, ackDue, updateDue]) registerLinkResolver(kind, caseLink);

const noticeTargets = `SELECT c.id, c.id AS context_id, c.account_id, c.role, c.business_id, r.membership_id
  FROM account_contexts c JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
  LEFT JOIN membership_roles r ON r.id = c.role_grant_id AND r.granted_at <= ${at} WHERE ${liveContextPredicate}`;
function caseSignals(access: SessionAccess, guard: CommandStatement, kind: string, event: string, recipient: string, foremanRevision = false): OperationWrites {
  const targets = scopedStatement(access, `SELECT ? AS kind, pc.id AS resource_id, dest.id AS required_scope,
    ${noticeExpiry} AS expires_at, ${at} AS created_at FROM aftercare_job j
    JOIN problem_cases pc ON pc.id = ${caseId} CROSS JOIN (${noticeTargets}) dest WHERE (${recipient})`, kind);
  return {
    statements: createLinkedNotifications(targets, guard, event, kind),
    changes: scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key,
      'upsert' AS op, ${at} AS at FROM notifications n WHERE n.event_key = ?
      UNION ALL SELECT 'job', j.id, dest.id, 'upsert', ${at} FROM aftercare_job j
      JOIN problem_cases pc ON pc.id = ${caseId} CROSS JOIN (${noticeTargets}) dest WHERE ${reporter("dest")}
        ${foremanRevision ? "OR (dest.role = 'foreman' AND dest.membership_id = j.accountable_foreman_membership_id)" : ""}`, event),
    effects: scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
      'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${noticeExpiry} AS expires_at FROM notifications n
      WHERE n.event_key = ? AND n.link_token IS NOT NULL`, event),
  };
}

const validEvidence = (parent: string) => `SELECT a.id, ${image} AS photo FROM json_each(?) input JOIN attachments a ON a.id = input.value
  JOIN media_stages m ON m.id = a.stage_id WHERE m.caller = 'case' AND m.parent_scope_id = ${parent} AND m.context_id = scope.context_id
  AND m.created_at <= ${at} AND m.expires_at > ${at} AND ${available} AND a.retention_class = 'unlinked'
  AND (${image} OR (${voice} AND a.duration_ms BETWEEN 1 AND 90000))
  AND NOT EXISTS (SELECT 1 FROM case_attachments link WHERE link.attachment_id = a.id)`;
const evidenceEligible = (parent: string) => `EXISTS (SELECT count(*) FROM (${validEvidence(parent)})
  HAVING count(*) = ? AND sum(photo) <= 5 AND sum(NOT photo) <= 1)`;
function attachEvidence(access: SessionAccess, guard: CommandStatement, ids: readonly string[]): CommandStatement[] {
  if (!ids.length) return [];
  return [scopedStatement(access, `INSERT INTO case_attachments (case_id, case_event_id, attachment_id)
    SELECT ${caseId}, ${eventId}, value FROM json_each(?) WHERE ${guard.sql}`, JSON.stringify(ids), ...guard.params ?? []),
  scopedStatement(access, `UPDATE attachments SET retention_class = 'case', delete_after = NULL
    WHERE id IN (SELECT attachment_id FROM case_attachments WHERE case_id = ${caseId} AND case_event_id = ${eventId}) AND ${guard.sql}`,
  ...guard.params ?? [])];
}

// No recipient is selected by the reporter. An unambiguous eligible context is
// snapshotted; future packets and reads still verify that narrow case grant.
const providerRouting = `case_recipients AS MATERIALIZED (
  SELECT c.id AS context_id, max(coalesce(g.valid_until, ${Number.MAX_SAFE_INTEGER})) AS valid_until, 'provider_billing' AS audience
  FROM aftercare_job j JOIN memberships m ON m.business_id = j.business_id AND m.state = 'active'
  JOIN accounts a ON a.id = m.account_id AND a.state = 'active' AND a.verified_at <= ${at}
  JOIN membership_roles role ON role.membership_id = m.id AND role.revoked_at IS NULL AND role.granted_at <= ${at}
  JOIN account_contexts c ON c.role_grant_id = role.id AND c.account_id = m.account_id AND c.business_id = m.business_id
  JOIN businesses b ON b.id = j.business_id AND b.state = 'approved'
  JOIN business_grants g ON g.membership_id = m.id AND g.business_id = j.business_id AND g.capability = 'record_paid' AND ${liveTerm("g")}
  WHERE c.role = 'provider_admin' AND role.role = c.role AND coalesce((SELECT category FROM opening), 'bill') = 'bill' GROUP BY c.id
  UNION ALL
  SELECT c.id, max(g.valid_until), 'provider_rectification' FROM aftercare_job j
  JOIN job_grants g ON g.job_id = j.id AND g.capability = 'rectification' AND ${liveTerm("g")}
  JOIN account_contexts c ON c.id = g.context_id AND c.business_id = j.business_id AND c.role IN ('foreman', 'provider_admin')
  JOIN accounts a ON a.id = c.account_id AND a.state = 'active' AND a.verified_at <= ${at}
  WHERE coalesce((SELECT category FROM opening), 'quality') IN ('quality', 'damage') AND ${liveContextPredicate}
    AND ${currentMembership("g", at)} IS NOT NULL GROUP BY c.id
), case_route AS MATERIALIZED (
  SELECT context_id, valid_until, audience FROM (
    SELECT *, count(*) OVER (PARTITION BY audience) AS recipient_count FROM case_recipients) WHERE recipient_count = 1
)`;

export function submitProblemCase(ctx: RequestScope, session: SessionAccess, { params, body }: SubmitCase, stewardId: string | undefined) {
  const { id, reportEventId, category, billId, affectedItem, description, evidence, expectedProviderAudience } = body.payload;
  const base = caseAccess(session, ctx.now, id, reportEventId, body.expectedRevision, params.j);
  const clock = withBusinessTargets(base, ctx.now);
  const reference = `BB-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
  const access: SessionAccess = { sql: `${clock.sql}, opening(reference, steward_id, category, bill_id, quote_id, change_id, line_no, disclosed_audience)
    AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?)), ${providerRouting}`, params: [...clock.params, reference, stewardId ?? null, category, billId ?? null,
    affectedItem?.kind === "quote" ? affectedItem.quoteVersionId : null, affectedItem?.kind === "change" ? affectedItem.changeVersionId : null,
    affectedItem?.lineNo ?? null, expectedProviderAudience] };
  return aftercareReceipt(ctx, base, {
    access, operationId: body.operationId, command: "case.report", input: [params.j, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE ${mayReport("scope")}
      ${category === "bill" ? `AND ${placeCapability("j.place_id", "scope.account_id", "bill_view")}` : ""})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j CROSS JOIN opening o
      JOIN accounts steward ON steward.id = o.steward_id AND steward.state = 'active' AND steward.verified_at <= ${at}
      WHERE ${revisionMatches} AND o.steward_id <> scope.account_id AND ${firstDeadline} IS NOT NULL AND ${ackDeadline} IS NOT NULL
      AND EXISTS (SELECT 1 FROM account_contexts c WHERE c.account_id = o.steward_id AND c.role = 'customer')
      AND (o.disclosed_audience IS NULL OR o.disclosed_audience IS (SELECT audience FROM case_route))
      AND (o.bill_id IS NULL OR EXISTS (SELECT 1 FROM bills b WHERE b.id = o.bill_id AND b.job_id = j.id AND b.issued_at <= ${at}))
      AND (o.quote_id IS NULL OR EXISTS (SELECT 1 FROM quote_versions q JOIN quote_items i ON i.version_id = q.id
        WHERE q.id = o.quote_id AND q.job_id = j.id AND i.line_no = o.line_no AND q.state = 'approved'))
      AND (o.change_id IS NULL OR EXISTS (SELECT 1 FROM change_versions v JOIN change_items i ON i.version_id = v.id
        WHERE v.id = o.change_id AND v.job_id = j.id AND i.line_no = o.line_no AND v.state = 'approved'))
      AND NOT EXISTS (SELECT 1 FROM problem_cases pc WHERE pc.id = ${caseId} OR pc.reference = o.reference)
      AND NOT EXISTS (SELECT 1 FROM case_events WHERE id = ${eventId})
      ${evidence.length ? `AND ${evidenceEligible("j.id")}` : ""})`,
    params: evidence.length ? [JSON.stringify(evidence), evidence.length] : [] },
    writes(guard) {
      const signals = caseSignals(base, guard, caseOpened, `case-opened:${id}`, owner("dest"));
      return { ...signals, statements: [scopedStatement(access, `INSERT INTO problem_cases
        (id, job_id, reference, reporter_id, case_owner_id, category, provider_audience, bill_id, quote_version_id,
          change_version_id, line_no, state, opened_at, acknowledge_by, first_update_by, next_update_at)
        SELECT ${caseId}, j.id, o.reference, scope.account_id, o.steward_id, o.category, o.disclosed_audience, o.bill_id,
          o.quote_id, o.change_id, o.line_no, 'open', ${at}, ${ackDeadline}, ${firstDeadline}, ${ackDeadline}
        FROM aftercare_job j CROSS JOIN opening o CROSS JOIN aftercare_actor scope WHERE ${guard.sql}`, ...guard.params ?? []),
      scopedStatement(base, `INSERT INTO case_events (id, case_id, job_id, actor_id, kind, audience, original_text, original_language, at)
        SELECT ${eventId}, ${caseId}, j.id, scope.account_id, 'reported', 'reporter_and_owner', ?, ?, ${at}
        FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${guard.sql}`, description.text, description.language, ...guard.params ?? []),
      ...attachEvidence(base, guard, evidence), ...(expectedProviderAudience === null ? [] : [scopedStatement(access, `INSERT INTO case_grants
        (case_id, context_id, capability, valid_from, valid_until) SELECT ${caseId}, context_id, audience, ${at}, valid_until
        FROM case_route WHERE ${guard.sql}`, ...guard.params ?? [])]), ...signals.statements,
      recordEffectIntents(guard, scopedStatement(base, `SELECT lower(hex(randomblob(16))) AS id, '${ackDue}' AS kind,
        '${ackDue}:' || id AS dedupe_key, id AS resource_ref, acknowledge_by AS due_at, ${Number.MAX_SAFE_INTEGER} AS expires_at
        FROM problem_cases WHERE id = ${caseId} UNION ALL SELECT lower(hex(randomblob(16))), '${updateDue}', '${updateDue}:first:' || id,
        id, first_update_by, ${Number.MAX_SAFE_INTEGER} FROM problem_cases WHERE id = ${caseId}`))] };
    },
  }, caseProjection("scope", caseId), body.expectedRevision);
}

export function appendCaseEvent(ctx: RequestScope, session: SessionAccess, { params, body }: AppendEvent) {
  const { kind, id, content } = body.payload;
  const evidence = "evidence" in body.payload ? body.payload.evidence : [];
  const completion = "completionId" in body.payload ? body.payload.completionId : null;
  const base = caseAccess(session, ctx.now, params.id, id, body.expectedRevision);
  const access = kind === "substantive_update" ? withBusinessTargets(base, ctx.now) : base;
  const ownerActs = owner("scope");
  const roleAllowed = {
    reporter_update: `${reporter("scope")} AND ${activeCase}`,
    acknowledged: `${ownerActs} AND pc.state = 'open' AND NOT EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = pc.id AND e.kind = 'acknowledged')`,
    substantive_update: `${activeCase} AND ((${ownerActs} AND ${nextDeadline} IS NOT NULL) OR ${mayUseCasePacket("scope")})`,
    correction_requested: `${ownerActs} AND ${activeCase} AND EXISTS (SELECT 1 FROM completions c WHERE c.id = ? AND c.job_id = j.id
      AND c.state = 'submitted' AND c.submitted_at <= ${at}) AND NOT EXISTS (SELECT 1 FROM sign_offs WHERE job_id = j.id)`,
    resolved: `${ownerActs} AND ${activeCase}`,
    closed: `${ownerActs} AND pc.state = 'resolved'`,
    provider_packet: `${ownerActs} AND ${activeCase} AND EXISTS (SELECT 1 FROM (${noticeTargets}) dest WHERE ${caseGrant("dest")})`,
  }[kind];
  const outboxTarget = `resource_ref = ${caseId} AND kind IN ('${ackDue}', '${updateDue}') AND state = 'pending'`;
  const isPacket = kind === "provider_packet";
  const recipient = isPacket ? caseGrant("dest") : `((${owner("dest")} OR ${reporter("dest")})
    AND dest.account_id <> (SELECT account_id FROM aftercare_actor))`;
  return aftercareReceipt(ctx, base, {
    access, operationId: body.operationId, command: `case.${kind}`, input: [params.id, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN problem_cases pc ON pc.id = ${caseId}
      WHERE pc.opened_at <= ${at} AND ${mayReadCase("scope")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN problem_cases pc ON pc.id = ${caseId} WHERE ${revisionMatches}
      AND (${roleAllowed}) AND NOT EXISTS (SELECT 1 FROM case_events WHERE id = ${eventId})
      ${evidence.length ? `AND ${evidenceEligible(caseId)}` : ""})`, params: [...(completion ? [completion] : []),
      ...(evidence.length ? [JSON.stringify(evidence), evidence.length] : [])] },
    writes(guard) {
      const signals = caseSignals(base, guard, isPacket ? providerPacket : caseUpdate, `case-event:${id}`, recipient, completion !== null);
      const statements: CommandStatement[] = [scopedStatement(base, `INSERT INTO case_events
        (id, case_id, job_id, actor_id, kind, audience, original_text, original_language, completion_id, at)
        SELECT ${eventId}, pc.id, pc.job_id, scope.account_id, ?, ${isPacket ? "pc.provider_audience" : "'reporter_and_owner'"}, ?, ?, ?, ${at}
        FROM problem_cases pc CROSS JOIN aftercare_actor scope WHERE pc.id = ${caseId} AND ${guard.sql}`, kind, content?.text ?? null,
      content?.language ?? null, completion, ...guard.params ?? []), ...attachEvidence(base, guard, evidence)];
      if (kind === "acknowledged" || kind === "substantive_update" || kind === "resolved" || kind === "closed") {
        const owns = `(SELECT account_id FROM aftercare_actor) = (SELECT case_owner_id FROM problem_cases WHERE id = ${caseId})`;
        const state = kind === "substantive_update" ? "'awaiting_plan'" : kind === "resolved" ? "'resolved'" : kind === "closed" ? "'closed'" : "state";
        const next = kind === "acknowledged" ? "first_update_by" : kind === "substantive_update" ? nextDeadline : "NULL";
        statements.push(scopedStatement(access, `UPDATE problem_cases SET state = ${state}, next_update_at = ${next}
          WHERE id = ${caseId} AND ${owns} AND ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(base, `UPDATE effect_outbox SET state = 'skipped' WHERE ${outboxTarget} AND ${owns}
          ${kind === "acknowledged" ? `AND kind = '${ackDue}'` : ""} AND ${guard.sql}`, ...guard.params ?? []));
        if (kind === "substantive_update") statements.push(recordEffectIntents(guard, scopedStatement(base, `SELECT lower(hex(randomblob(16))) AS id,
          '${updateDue}' AS kind, '${updateDue}:' || ${eventId} AS dedupe_key, id AS resource_ref, next_update_at AS due_at,
          ${Number.MAX_SAFE_INTEGER} AS expires_at FROM problem_cases WHERE id = ${caseId} AND ${owns}`)));
      }
      if (completion !== null) statements.push(scopedStatement(base, `UPDATE completions SET state = 'returned' WHERE id = ? AND ${guard.sql}`,
        completion, ...guard.params ?? []), scopedStatement(base, `UPDATE jobs SET revision = revision + 1
        WHERE id = (SELECT job_id FROM problem_cases WHERE id = ${caseId}) AND ${guard.sql}`, ...guard.params ?? []));
      return { ...signals, statements: [...statements, ...signals.statements] };
    },
  }, caseProjection("scope", caseId), body.expectedRevision);
}

// Sweep these rows in the existing scheduled D1 claim batch. A superseded
// target, closed case, or inactive steward yields no notification at its due time.
export function caseSweepStatements(now: number): CommandStatement[] {
  const work = `WITH clock(at) AS (VALUES (?)), due AS MATERIALIZED (
    SELECT e.id, e.kind, e.dedupe_key, e.resource_ref, e.due_at, e.expires_at FROM effect_outbox e
    WHERE e.state = 'pending' AND e.kind IN ('${ackDue}', '${updateDue}') AND e.due_at <= ${at}
    ORDER BY e.due_at, e.id LIMIT 32
  ), candidates AS MATERIALIZED (
    SELECT due.id AS effect_id, due.kind, due.dedupe_key AS event_key, pc.id AS resource_id, c.id AS required_scope,
      ${noticeExpiry} AS expires_at, ${at} AS created_at FROM due JOIN problem_cases pc ON pc.id = due.resource_ref
    JOIN accounts a ON a.id = pc.case_owner_id AND a.state = 'active' JOIN account_contexts c ON c.account_id = a.id AND c.role = 'customer'
    WHERE due.expires_at > ${at} AND CASE
      WHEN due.kind = '${ackDue}' THEN pc.state = 'open' AND due.due_at = pc.acknowledge_by
        AND NOT EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = pc.id AND e.kind = 'acknowledged')
      WHEN pc.state = 'open' THEN due.due_at = pc.first_update_by
      WHEN pc.state = 'awaiting_plan' THEN due.due_at = pc.next_update_at ELSE 0 END
  )`;
  const token = linkTokenFor("t.kind", "t.resource_id", "t.required_scope", "t.expires_at");
  const posted = `FROM candidates t JOIN notifications n ON n.context_id = t.required_scope AND n.event_key = t.event_key
    WHERE n.created_at = t.created_at AND n.link_token IS NOT NULL`;
  return [createLinkTarget({ sql: `${work} SELECT * FROM candidates`, params: [now] }),
    { sql: `${work} INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
      SELECT lower(hex(randomblob(16))), t.required_scope, t.event_key, t.kind, ${token}, t.created_at FROM candidates t WHERE 1
      ON CONFLICT (context_id, event_key) DO NOTHING`, params: [now] },
    { sql: `${work} INSERT INTO sync_changes (kind, resource_id, partition_key, op, at)
      SELECT 'notification', n.id, n.context_id, 'upsert', ${at} ${posted}`, params: [now] },
    { sql: `${work} INSERT INTO effect_outbox (id, kind, dedupe_key, resource_ref, due_at, state, expires_at)
      SELECT lower(hex(randomblob(16))), 'notification_push', 'notification_push:' || n.id, n.id, ${at}, 'pending', t.expires_at
      ${posted} ON CONFLICT (dedupe_key) DO NOTHING`, params: [now] },
    { sql: `${work} UPDATE effect_outbox SET state = CASE WHEN EXISTS (SELECT 1 FROM candidates WHERE effect_id = effect_outbox.id)
      THEN 'delivered' ELSE 'skipped' END WHERE id IN (SELECT id FROM due)`, params: [now] }];
}

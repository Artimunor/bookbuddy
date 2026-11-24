import type {
  ErrorBody, RouteResponse, getJobCompletionRoute, returnCompletionRoute, signOffCompletionRoute, submitCompletionRoute,
} from "@bookbuddy/api-contract";
import { AFTERCARE_TARGETS } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation, recordEffectIntents } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, displayName, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { withSiteClock } from "../commercial/deadlines";
import { customer, foreman } from "../commercial/policy";
import { readyPhotoSql } from "../field/attendance";
import { currentMembership } from "../jobs/projections";
import { createLinkedNotifications } from "../links/notifications";
import { casePacket, casePacketExists, caseProviderGrant } from "./case-policy";
import { approvedInvoice, billReferenceReserved, billSignals, issuedBillNotice } from "./invoice";

export const dayMs = 86_400_000;
export const reminderKind = "sign_off_reminder";
export const followUpKind = "sign_off_follow_up";
const readyKind = "completion_ready";
const revisionMatches = "(? IS NULL OR j.revision = ?)";

export const jobSource = (predicate: string) => `SELECT j.*, p.state AS place_state, p.owner_id, p.named_approver_id, p.alias,
    coalesce(p.site_zone, area.site_zone) AS site_zone, b.public_name, r.submitted_at
  FROM jobs j JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  JOIN operating_areas area ON area.id = b.catchment_id LEFT JOIN requests r ON r.job_id = j.id WHERE ${predicate}`;

export function aftercareAccess(session: SessionAccess, now: number, id: string, byCompletion = false): SessionAccess {
  const clock = accessClock(session, now);
  return { sql: `${clock.sql}, aftercare_job AS MATERIALIZED (${jobSource(byCompletion
    ? "j.id = (SELECT job_id FROM completions WHERE id = ?)" : "j.id = ?")}),
    aftercare_actor AS MATERIALIZED (SELECT s.*, ${currentMembership("s", at)} AS membership_id FROM live_scope s)`,
  params: [...clock.params, id] };
}

export function withAftercareSiteClock(access: SessionAccess, now: number): SessionAccess {
  return withSiteClock(access, now, "aftercare_job");
}

// In a site clock overlap choose the first instant; in a gap choose its end.
export function calendarDeadline(from: string, days: number): string {
  const wall = `(${from} + source.offset_ms + ${days * dayMs})`;
  return `(SELECT min(max(target.starts, ${wall} - target.offset_ms)) FROM site_clock source CROSS JOIN site_clock target
    WHERE ${from} >= source.starts AND ${from} < source.ends
      AND max(target.starts, ${wall} - target.offset_ms) < target.ends)`;
}

export const aftercareJobValue = `json_object('jobId', j.id, 'reference', j.reference, 'title', nullif(j.trade, ''),
  'placeAlias', j.alias, 'siteZone', j.site_zone, 'providerDisplayName', j.public_name)`;

export const nameOf = (account: string) => `(SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${account})`;
export const authored = (text: string, language: string) =>
  `CASE WHEN ${text} IS NOT NULL THEN json_object('original', json_object('language', ${language}, 'text', ${text}), 'reading', NULL) END`;
const flag = (condition: string) => `json(CASE WHEN (${condition}) THEN 'true' ELSE 'false' END)`;
const stamp = (time: string, account: string) => `json_object('at', ${time}, 'actorDisplayName', ${nameOf(account)})`;
const scopeRef = (item: string) => `CASE WHEN ${item}.quote_version_id IS NOT NULL THEN json_object('kind', 'quote',
    'quoteVersionId', ${item}.quote_version_id, 'lineNo', ${item}.line_no)
  ELSE json_object('kind', 'change', 'changeVersionId', ${item}.change_version_id, 'lineNo', ${item}.line_no) END`;
const visible = (scope: string) => `(${customer(scope)} OR ${foreman(scope)})`;
export const signOffGrant = (actor: string) => `SELECT g.id FROM place_grants g WHERE g.place_id = j.place_id
  AND j.named_approver_id = ${actor} AND j.place_state IN ('in_area', 'out_of_area')
  AND g.account_id = ${actor} AND g.capability = 'sign_off' AND ${liveTerm("g")}
  ORDER BY g.valid_from DESC, g.id LIMIT 1`;

const currentId = `(SELECT id FROM completions WHERE job_id = j.id AND state <> 'superseded')`;
const finish = `SELECT e.at AS finished_at, v.id AS visit_id FROM visits v
  JOIN visit_activity_events e ON e.visit_id = v.id AND e.kind = 'work_finished' AND e.at <= ${at}
  WHERE v.job_id = j.id AND v.kind = 'work' AND v.state = 'finished' ORDER BY e.at DESC, e.id DESC LIMIT 1`;
const finishedAt = `(SELECT finished_at FROM (${finish}))`;
const crewAttendance = `FROM shifts sh JOIN shift_slots slot ON slot.shift_id = sh.id
  JOIN assignments a ON a.slot_id = slot.id AND a.state IN ('confirmed', 'completed')
  JOIN attendance_events e ON e.assignment_id = a.id AND e.review_state = 'accepted' AND e.received_at <= ${at}
  WHERE sh.visit_id = work.visit_id AND NOT EXISTS (SELECT 1 FROM attendance_events next WHERE next.corrects_id = e.id
    AND next.review_state = 'accepted' AND next.received_at <= ${at})`;
const checkout = `(SELECT CASE WHEN sum(kind = 'arrival') = sum(kind = 'departure') THEN max(actual_at) FILTER (WHERE kind = 'departure') END
  FROM (SELECT e.kind, e.actual_at ${crewAttendance}))`;

// A foreman cannot issue directly. The same account may authorize the hint
// through its provider-admin role; sign-off must still honor that exact grant.
const billingGrantFor = (account: string, match: string) => `SELECT g.id FROM business_grants g
  JOIN memberships m ON m.id = g.membership_id AND m.business_id = g.business_id AND m.account_id = ${account} AND m.state = 'active'
  JOIN businesses b ON b.id = g.business_id AND b.state = 'approved'
  JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  JOIN account_contexts admin ON admin.role = 'provider_admin' AND admin.account_id = a.id AND admin.business_id = g.business_id
  JOIN membership_roles r ON r.id = admin.role_grant_id AND r.role = admin.role AND r.membership_id = m.id
    AND r.revoked_at IS NULL AND r.granted_at <= ${at}
  WHERE g.business_id = j.business_id AND g.capability = 'issue_bill' AND ${match} AND ${liveTerm("g")}
  ORDER BY g.valid_from DESC, g.id LIMIT 1`;
const billingGrant = (scope: string) => billingGrantFor(`${scope}.account_id`, `g.membership_id = ${scope}.membership_id`);

const returnedOrEmpty = `NOT EXISTS (SELECT 1 FROM completions WHERE job_id = j.id AND state IN ('submitted', 'signed_off'))`;
export const awaitingSignOff = (completion: string) => `${completion}.state = 'submitted' AND ${completion}.submitted_at <= ${at}
  AND j.state <> 'cancelled' AND j.place_state IN ('in_area', 'out_of_area')`;

// All lines are selected from one approved base and its approved change records, never the submitted IDs.
const approvedLines = (quote: string, cutoff: string, job = "j.id") => `SELECT qi.version_id AS quote_version_id, NULL AS change_version_id,
    qi.line_no, qi.original_label, qi.evidence_rule, qi.evidence_alternative, base.original_locale, 0 AS change_at, 0 AS delta_minor,
    0 AS delta_net, 0 AS delta_tax
  FROM quote_versions base JOIN quote_items qi ON qi.version_id = base.id WHERE base.id = ${quote}
  UNION ALL
  SELECT NULL, ci.version_id, ci.line_no, ci.original_label, ci.evidence_rule, ci.evidence_alternative,
    cv.original_locale, a.at, cv.delta_minor, ci.net_minor, ci.tax_minor
  FROM change_proposals cp JOIN change_versions cv ON cv.proposal_id = cp.id AND cv.job_id = cp.job_id AND cv.state = 'approved'
  JOIN approvals a ON a.change_version_id = cv.id AND a.decision = 'approve' AND a.at <= ${cutoff}
  JOIN change_items ci ON ci.version_id = cv.id WHERE cp.job_id = ${job} AND cp.base_quote_version_id = ${quote}`;
const sameLine = (a: string, b: string) => `${a}.quote_version_id IS ${b}.quote_version_id
  AND ${a}.change_version_id IS ${b}.change_version_id AND ${a}.line_no = ${b}.line_no`;
const exactScope = (completion: string) => `EXISTS (SELECT 1 FROM completion_items i WHERE i.completion_id = ${completion}.id)
  AND NOT EXISTS (SELECT 1 FROM (${approvedLines(`${completion}.base_quote_version_id`, at)}) line WHERE NOT EXISTS (
    SELECT 1 FROM completion_items i WHERE i.completion_id = ${completion}.id AND ${sameLine("i", "line")}))`;

export const isSignOffRecipient = (scope: string, completion: string) => `${customer(scope)} AND ${awaitingSignOff(completion)}
  AND ${completion}.submitter_id <> ${scope}.account_id AND EXISTS (${signOffGrant(`${scope}.account_id`)})
  AND ${exactScope(completion)}`;
const signOffValue = `json_object('id', s.id, 'completionId', c.id, 'completionVersion', c.no, 'quoteVersionId', c.base_quote_version_id,
  'termsHash', s.terms_hash, 'at', s.at, 'actorDisplayName', ${nameOf("s.approver_id")})`;

const itemProjection = `json_remove(json_object('id', i.id, 'scope', json(${scopeRef("i")}), 'outcome', i.outcome,
  'result', json(${authored("i.result_note", "i.original_language")}), 'reason', json(${authored("i.not_done_reason", "i.original_language")}),
  'evidenceAlternative', json(${authored("i.evidence_alternative", `coalesce(
    (SELECT original_locale FROM quote_versions WHERE id = i.quote_version_id),
    (SELECT original_locale FROM change_versions WHERE id = i.change_version_id))`)}),
  'photos', json((SELECT json_group_array(json(photo)) FROM (SELECT json_object('attachmentId', media.id,
    'availability', CASE WHEN ${readyPhotoSql("media")} THEN 'available' ELSE 'unavailable' END,
    'capturedAt', NULL, 'caption', json(${authored("link.caption", "link.caption_language")})) AS photo
    FROM completion_attachments link JOIN attachments media ON media.id = link.attachment_id
    WHERE link.completion_id = i.completion_id AND link.completion_item_id = i.id ORDER BY media.id)))),
  CASE WHEN i.outcome = 'done' THEN '$.reason' ELSE '$.result' END,
  CASE WHEN i.outcome = 'done' THEN '$.reason' ELSE '$.evidenceAlternative' END)`;
const completionStamp = (alias: string, receiptState?: "submitted" | "returned") => `json_object('id', ${alias}.id, 'version', ${alias}.no,
  'state', ${receiptState ? `'${receiptState}'` : `${alias}.state`}, 'submitted', json(${stamp(`${alias}.submitted_at`, `${alias}.submitter_id`)}),
  'finishedAt', ${alias}.finished_at)`;

// Correlates to the already scoped job and viewer. History never exposes staff-only hints to a customer.
export function completionValue(scope: string, version: string, receiptState?: "submitted" | "returned"): string {
  const customerView = `${scope}.role = 'customer'`;
  const submitted = `json_set(${completionStamp("chosen", receiptState)}, '$.items', json((SELECT json_group_array(json(value)) FROM (
    SELECT ${itemProjection} AS value FROM completion_items i WHERE i.completion_id = chosen.id
    ORDER BY i.quote_version_id IS NULL, i.change_version_id, i.line_no))))`;
  const sharedWithProvider = `${caseProviderGrant(scope)} AND ${casePacketExists}`;
  const caseVisible = `((${customerView} AND pc.reporter_id = ${scope}.account_id) OR (${sharedWithProvider}))`;
  return `(WITH chosen AS MATERIALIZED (SELECT * FROM completions WHERE job_id = j.id AND id = coalesce(${version}, ${currentId})),
    base AS MATERIALIZED (SELECT q.*, t.hash FROM quote_versions q JOIN terms_versions t ON t.id = q.terms_id
      JOIN approvals a ON a.quote_version_id = q.id AND a.decision = 'approve' AND a.at <= ${at}
      WHERE q.job_id = j.id AND q.state = 'approved' AND q.id = coalesce((SELECT base_quote_version_id FROM chosen), q.id)),
    basis AS (SELECT coalesce((SELECT submitted_at FROM chosen WHERE state <> 'returned' OR ${version} IS NOT NULL), ${at}) AS at),
    approved_lines AS MATERIALIZED (${approvedLines("(SELECT id FROM base)", "(SELECT at FROM basis)")}),
    work_finish AS MATERIALIZED (${finish}),
    section AS (SELECT json_object('audience', ${scope}.role, 'job', json(${aftercareJobValue}),
      'approvedScope', json_object('quoteVersionId', base.id, 'version', base.no, 'termsHash', base.hash,
        'totalMinor', base.total_minor + coalesce((SELECT sum(delta_minor) FROM (SELECT delta_minor FROM approved_lines
          WHERE change_version_id IS NOT NULL GROUP BY change_version_id)), 0),
        'currency', base.currency, 'scope', json(${authored("base.scope", "base.original_locale")}),
        'exclusions', json(${authored("nullif(base.exclusions, '')", "base.original_locale")}),
        'lines', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('ref', json(${scopeRef("line")}),
          'label', json(${authored("line.original_label", "line.original_locale")}), 'evidenceRule', line.evidence_rule,
          'evidenceAlternative', line.evidence_alternative) AS value FROM approved_lines line
          ORDER BY line.change_at, line.change_version_id, line.line_no)))),
      'namedApproverDisplayName', ${nameOf("j.named_approver_id")}, 'history', json((SELECT json_group_array(json(value)) FROM (
        SELECT ${completionStamp("c")} AS value FROM completions c WHERE c.job_id = j.id AND c.id IS NOT chosen.id ORDER BY c.no DESC))),
      'signOff', json((SELECT ${signOffValue} FROM sign_offs s JOIN completions c ON c.id = s.completion_id
        WHERE s.job_id = j.id AND c.id = chosen.id)),
      'openCases', json((SELECT json_group_array(json(value)) FROM (SELECT json_object('id', pc.id, 'reference', pc.reference,
        'state', pc.state) AS value FROM problem_cases pc WHERE pc.job_id = j.id AND pc.state IN ('open', 'awaiting_plan')
        AND ${caseVisible} ORDER BY pc.opened_at DESC, pc.id))),
      'submission', json(CASE WHEN chosen.id IS NOT NULL THEN ${submitted} END)) AS value,
      chosen.bill_reference_hint AS hint,
      chosen.bill_amount_minor AS invoice_amount,
      CASE WHEN NOT (${customerView}) THEN (SELECT json_object(
        'netMinor', base.net_minor + coalesce(sum(delta_net), 0),
        'taxMinor', base.tax_minor + coalesce(sum(delta_tax), 0)) FROM approved_lines) END AS invoice_basis,
      CASE WHEN ${customerView} THEN json_object('signOff', ${flag(isSignOffRecipient(scope, "chosen"))},
        'seeBill', ${flag("chosen.state = 'signed_off'")}, 'reportProblem', ${flag("chosen.id IS NOT NULL AND j.state <> 'cancelled'")})
      ELSE json_object('submit', ${flag(`j.state = 'open' AND j.place_state IN ('in_area', 'out_of_area')
        AND work.finished_at IS NOT NULL AND ${returnedOrEmpty}`)},
        'messageApprover', ${flag("chosen.state = 'submitted'")},
        'canIssueBill', ${flag(`EXISTS (${billingGrant(scope)})`)}) END AS actions,
      CASE WHEN NOT (${customerView}) AND work.finished_at IS NOT NULL THEN json_object('finishedAt', work.finished_at,
        'crewCheckedOutAt', ${checkout}) END AS work,
      CASE WHEN NOT (${customerView}) AND chosen.state = 'returned' THEN (SELECT json_object('at', e.at,
        'actorDisplayName', ${nameOf("e.actor_id")}, 'caseId', pc.id, 'reason', json(${authored("e.original_text", "e.original_language")}))
        FROM case_events e JOIN problem_cases pc ON pc.id = e.case_id AND pc.job_id = j.id
        WHERE e.completion_id = chosen.id AND ${casePacket("e")} AND ${caseProviderGrant(scope)}
        ORDER BY e.at DESC, e.id DESC LIMIT 1) END AS correction
    FROM base LEFT JOIN chosen ON 1 LEFT JOIN work_finish work ON NOT (${customerView})
    WHERE j.named_approver_id IS NOT NULL AND (${version} IS NULL OR chosen.id IS NOT NULL))
  SELECT CASE WHEN ${customerView} THEN json_set(value, '$.actions', json(actions))
    ELSE json_set(value, '$.submission.billReference', hint, '$.submission.billAmountMinor', invoice_amount, '$.actions', json(actions),
      '$.approvedScope', json_patch(value -> '$.approvedScope', invoice_basis),
      '$.work', json(work), '$.correction', json(correction)) END FROM section)`;
}

type CompletionRead = RouteResponse<typeof getJobCompletionRoute.input>;
type Submit = RouteResponse<typeof submitCompletionRoute.input>;
type SignOff = RouteResponse<typeof signOffCompletionRoute.input>;
type Return = RouteResponse<typeof returnCompletionRoute.input>;

export function readCompletion(session: SessionAccess, now: number, input: CompletionRead) {
  const access = aftercareAccess(session, now, input.params.j);
  return scopedStatement(access, `, requested AS (SELECT ? AS id)
    SELECT (SELECT ${completionValue("scope", "(SELECT id FROM requested)")}
      FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${visible("scope")}) AS value FROM acting_session`,
  input.query?.versionId ?? null);
}

export interface AftercareReceiptResult { value: string | null; operation: OperationResult; error?: ErrorBody }
export async function aftercareReceipt(ctx: RequestScope, access: SessionAccess, spec: OperationSpec, projection: string,
  expected: number | undefined, params: readonly unknown[] = [],
): Promise<CommandInput<AftercareReceiptResult>> {
  const op = await planOperation(ctx, { ...spec, scope: { sql: "SELECT * FROM aftercare_actor" } });
  return { statements: [...op.statements, scopedStatement(access, `SELECT j.revision,
    CASE WHEN EXISTS (SELECT 1 FROM operation_receipts r WHERE r.account_id = scope.account_id AND r.context_id = scope.context_id
      AND r.operation_id = ? AND r.command = ?) THEN (${projection}) END AS value
    FROM aftercare_job j CROSS JOIN aftercare_actor scope`, spec.operationId, spec.command, ...params)], decode(results) {
    const operation = op.decode(results);
    const row = results[op.statements.length]?.results[0] as { revision: number; value: string | null } | undefined;
    if (operation.outcome.status !== "rejected") return { operation, value: row?.value ?? null };
    const original = operation.outcome.error;
    const error: ErrorBody = original.code === "CONFLICT" && expected !== undefined && row && row.revision !== expected
      ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } } : original;
    return { operation, value: null, error };
  } };
}

const customerContexts = `JOIN place_people pp ON pp.place_id = j.place_id AND pp.ends_at IS NULL AND pp.verified_from <= ${at}
  JOIN accounts person ON person.id = pp.account_id AND person.state = 'active'
  JOIN account_contexts target ON target.account_id = person.id AND target.role = 'customer'`;
const jobChanges = `SELECT 'job' AS kind, j.id AS resource_id, target.id AS partition_key, 'upsert' AS op, ${at} AS at
  FROM aftercare_job j ${customerContexts} WHERE ${customer("target")}`;
const notificationsChange = `SELECT 'notification', n.id, n.context_id, 'upsert', ${at} FROM notifications n WHERE n.event_key = ?`;
const mayCloseJob = `state = 'open' AND EXISTS (
  SELECT 1 FROM bills b JOIN paid_records r ON r.bill_id = b.id AND r.kind = 'matched'
  WHERE b.job_id = jobs.id AND b.state = 'issued' AND NOT EXISTS (SELECT 1 FROM paid_records next WHERE next.prior_id = r.id))`;
const updateRevision = (access: SessionAccess, guard: CommandStatement, close = false) => scopedStatement(access,
  `UPDATE jobs SET revision = revision + 1${close ? `, state = CASE WHEN ${mayCloseJob} THEN 'closed' ELSE state END,
    closed_at = CASE WHEN ${mayCloseJob} THEN ${at} ELSE closed_at END` : ""}
    WHERE id = (SELECT id FROM aftercare_job) AND ${guard.sql}`, ...guard.params ?? []);

const commandBody = `, result_input(id) AS (VALUES (?))`;
const resultId = "(SELECT id FROM result_input)";
const resultAccess = (access: SessionAccess, id: string): SessionAccess => ({ sql: access.sql + commandBody, params: [...access.params, id] });
const foreachItem = `SELECT item.value ->> 'id' AS id, item.value ->> '$.scope.quoteVersionId' AS quote_version_id,
    item.value ->> '$.scope.changeVersionId' AS change_version_id, item.value ->> '$.scope.lineNo' AS line_no,
    item.value ->> 'outcome' AS outcome, item.value ->> 'originalLanguage' AS language, item.value ->> 'resultNote' AS result,
    item.value ->> 'reason' AS reason, item.value ->> 'evidenceAlternative' AS alternative, item.value -> 'photos' AS photos
  FROM json_each(?) item`;
const validPhotos = `SELECT i.id AS item_id, media.id AS attachment_id, p.value ->> '$.caption.text' AS caption,
    p.value ->> '$.caption.language' AS caption_language
  FROM input_items i CROSS JOIN json_each(i.photos) p JOIN attachments media ON media.id = p.value ->> 'attachmentId'
  JOIN media_stages stage ON stage.id = media.stage_id
  WHERE stage.caller = 'completion' AND stage.parent_scope_id = (SELECT id FROM aftercare_job)
    AND stage.created_at <= ${at} AND ${readyPhotoSql("media")} AND (
      (stage.context_id = (SELECT context_id FROM aftercare_actor) AND stage.expires_at > ${at} AND media.retention_class = 'unlinked'
        AND NOT EXISTS (SELECT 1 FROM completion_attachments linked WHERE linked.attachment_id = media.id))
      OR EXISTS (SELECT 1 FROM completion_attachments linked JOIN completion_items prior ON prior.id = linked.completion_item_id
        WHERE linked.completion_id = (SELECT prior_id FROM completion_input) AND linked.attachment_id = media.id
          AND ${sameLine("i", "prior")})
    )`;

export function submitCompletion(ctx: RequestScope, session: SessionAccess, { params, body }: Submit) {
  const { id, baseQuoteVersionId, expectedCompletionId, items, billReference, billAmountMinor } = body.payload;
  const bodyAccess = resultAccess(aftercareAccess(session, ctx.now, params.j), id);
  const clock = withAftercareSiteClock(bodyAccess, ctx.now);
  const timed: SessionAccess = { sql: `${clock.sql}, completion_deadlines AS MATERIALIZED (SELECT
      ${calendarDeadline(at, AFTERCARE_TARGETS.signOffReminderCalendarDays)} AS reminder,
      ${calendarDeadline(at, AFTERCARE_TARGETS.signOffFollowUpCalendarDays)} AS follow_up FROM aftercare_job)`, params: clock.params };
  const input = `, input_items AS MATERIALIZED (${foreachItem}), completion_input(base_id, prior_id, bill_reference, bill_amount)
    AS (VALUES (?, ?, ?, ?))`;
  const inputParams = [JSON.stringify(items), baseQuoteVersionId, expectedCompletionId, billReference ?? null, billAmountMinor ?? null];
  const writesAccess: SessionAccess = { sql: bodyAccess.sql + input, params: [...bodyAccess.params, ...inputParams] };
  const access: SessionAccess = { sql: timed.sql + input, params: [...timed.params, ...inputParams] };
  const baseId = "(SELECT base_id FROM completion_input)";
  const invoiceAssertion = billReference === undefined ? "" : `AND EXISTS (
    SELECT 1 FROM (SELECT (${approvedInvoice(at)}) AS approved) CROSS JOIN completion_input input
    WHERE approved ->> 'net' >= 0 AND approved ->> 'tax' >= 0
      AND (approved ->> 'net') + (approved ->> 'tax') = input.bill_amount
      AND (NOT EXISTS (${billingGrant("scope")}) OR EXISTS (SELECT 1 FROM bills b WHERE b.job_id = j.id AND b.state = 'issued') OR (
        NOT EXISTS (SELECT 1 FROM bills b WHERE b.business_id = j.business_id AND b.number = input.bill_reference AND b.version = 1)
        AND NOT (${billReferenceReserved("input.bill_reference")}))))`;
  const eventKey = `${readyKind}:${id}`;
  const notificationExpiry = `${at} + ${7 * dayMs}`;
  return aftercareReceipt(ctx, bodyAccess, {
    access, operationId: body.operationId, command: "completion.submit", input: [params.j, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE ${foreman("scope")})` },
    eligible: { sql: `EXISTS (WITH allowed_photos AS MATERIALIZED (${validPhotos}),
      approved AS MATERIALIZED (${approvedLines(baseId, at, "(SELECT id FROM aftercare_job)")})
      SELECT 1 FROM aftercare_job j WHERE j.state = 'open' AND j.place_state IN ('in_area', 'out_of_area')
        AND j.named_approver_id IS NOT NULL AND ${revisionMatches}
        AND ${currentId} IS ? AND ${returnedOrEmpty} AND EXISTS (${finish})
        AND (SELECT follow_up FROM completion_deadlines) IS NOT NULL
        AND EXISTS (SELECT 1 FROM quote_versions q JOIN approvals a ON a.quote_version_id = q.id AND a.decision = 'approve'
          AND a.at <= ${at} WHERE q.id = ${baseId} AND q.job_id = j.id AND q.state = 'approved')
        AND NOT EXISTS (SELECT 1 FROM completions WHERE id = ${resultId})
        ${invoiceAssertion}
        AND (SELECT count(*) FROM input_items) = (SELECT count(*) FROM approved)
        AND NOT EXISTS (SELECT 1 FROM input_items i LEFT JOIN approved line ON ${sameLine("i", "line")}
          WHERE line.line_no IS NULL OR EXISTS (SELECT 1 FROM completion_items WHERE id = i.id)
            OR json_array_length(i.photos) <> (SELECT count(*) FROM allowed_photos p WHERE p.item_id = i.id)
            OR i.outcome = 'done' AND (
              (i.alternative IS NOT NULL AND i.alternative IS NOT line.evidence_alternative)
              OR (i.alternative IS NULL AND json_array_length(i.photos) = 0))))`,
    params: [body.expectedRevision ?? null, body.expectedRevision ?? null, expectedCompletionId] },
    writes(guard) {
      const prior = { sql: `UPDATE completions SET state = 'superseded' WHERE id = ? AND ${guard.sql}`,
        params: [expectedCompletionId, ...guard.params ?? []] };
      const targets = scopedStatement(bodyAccess, `SELECT 'completion_ready' AS kind, c.id AS resource_id, target.id AS required_scope,
        ${notificationExpiry} AS expires_at, ${at} AS created_at FROM aftercare_job j
        JOIN completions c ON c.job_id = j.id AND c.id = ${resultId} ${customerContexts}
        WHERE ${isSignOffRecipient("target", "c")}`);
      const notifications = createLinkedNotifications(targets, guard, eventKey, readyKind);
      return {
        statements: [...(expectedCompletionId === null ? [] : [prior]),
          scopedStatement(writesAccess, `INSERT INTO completions (id, job_id, base_quote_version_id, no, submitter_id, finished_at,
            submitted_at, bill_reference_hint, bill_amount_minor, bill_hint_by, bill_hint_grant_id, state) SELECT ${resultId}, j.id, input.base_id,
            1 + coalesce((SELECT max(no) FROM completions WHERE job_id = j.id), 0), scope.account_id,
            ${finishedAt}, ${at}, input.bill_reference, input.bill_amount,
            CASE WHEN input.bill_reference IS NOT NULL THEN scope.account_id END,
            CASE WHEN input.bill_reference IS NOT NULL THEN (${billingGrant("scope")}) END, 'submitted'
            FROM aftercare_job j CROSS JOIN aftercare_actor scope CROSS JOIN completion_input input WHERE ${guard.sql}`, ...guard.params ?? []),
          scopedStatement(writesAccess, `INSERT INTO completion_items (id, completion_id, quote_version_id, change_version_id, line_no,
            outcome, original_language, result_note, not_done_reason, evidence_alternative)
            SELECT id, ${resultId}, quote_version_id, change_version_id, line_no, outcome, language, result, reason, alternative
            FROM input_items WHERE ${guard.sql}`, ...guard.params ?? []),
          ...(items.some(({ photos }) => photos.length) ? [scopedStatement(writesAccess, `INSERT INTO completion_attachments
            (completion_item_id, completion_id, attachment_id, caption, caption_language)
            SELECT item_id, ${resultId}, attachment_id, caption, caption_language
            FROM (${validPhotos}) p WHERE ${guard.sql}`, ...guard.params ?? []),
          scopedStatement(bodyAccess, `UPDATE attachments SET retention_class = 'decision', delete_after = NULL
            WHERE retention_class = 'unlinked' AND id IN (
              SELECT attachment_id FROM completion_attachments WHERE completion_id = ${resultId}) AND ${guard.sql}`,
          ...guard.params ?? [])] : []), updateRevision(bodyAccess, guard), ...notifications,
          recordEffectIntents(guard, scopedStatement(timed, `SELECT lower(hex(randomblob(16))) AS id, '${reminderKind}' AS kind,
            '${reminderKind}:' || ${resultId} AS dedupe_key, ${resultId} AS resource_ref, reminder AS due_at, follow_up AS expires_at
            FROM completion_deadlines UNION ALL SELECT lower(hex(randomblob(16))), '${followUpKind}', '${followUpKind}:' || ${resultId},
            ${resultId}, follow_up, ${Number.MAX_SAFE_INTEGER} FROM completion_deadlines`)),
        ],
        changes: scopedStatement(bodyAccess, `${jobChanges} UNION ALL ${notificationsChange}`, eventKey),
        effects: scopedStatement(bodyAccess, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
          'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${notificationExpiry} AS expires_at
          FROM notifications n WHERE n.event_key = ? AND n.link_token IS NOT NULL`, eventKey),
      };
    },
  }, completionValue("scope", resultId, "submitted"), body.expectedRevision);
}

const disablePending = (access: SessionAccess, guard: CommandStatement) => scopedStatement(access, `UPDATE effect_outbox
  SET state = 'skipped' WHERE state = 'pending' AND ${guard.sql} AND (
    dedupe_key IN ('${reminderKind}:' || ${resultId}, '${followUpKind}:' || ${resultId}) OR dedupe_key IN (
      SELECT 'notification_push:' || n.id FROM link_targets l JOIN notifications n ON n.link_token = l.token
      WHERE l.resource_id = ${resultId} AND l.kind IN ('${readyKind}', '${reminderKind}', '${followUpKind}')))`, ...guard.params ?? []);

export function signOffCompletion(ctx: RequestScope, session: SessionAccess, { params, body }: SignOff) {
  const access = resultAccess(aftercareAccess(session, ctx.now, params.id, true), params.id);
  const billId = crypto.randomUUID();
  const billingAccess: SessionAccess = { sql: `${access.sql}, sign_off_bill(id) AS (VALUES (?))`, params: [...access.params, billId] };
  const clock = withAftercareSiteClock(billingAccess, ctx.now);
  const candidate = "(SELECT id FROM sign_off_bill)";
  const { id, termsHash } = body.payload;
  return aftercareReceipt(ctx, access, {
    access, operationId: body.operationId, command: "completion.sign_off", input: [params.id, body], resultRef: id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE ${customer("scope")} AND EXISTS (${signOffGrant("scope.account_id")}))` },
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN completions c ON c.job_id = j.id AND c.id = ${resultId}
      JOIN quote_versions q ON q.id = c.base_quote_version_id AND q.state = 'approved' JOIN terms_versions t ON t.id = q.terms_id
      WHERE ${awaitingSignOff("c")} AND ${revisionMatches} AND c.submitter_id <> scope.account_id AND t.hash = ?
      AND ${exactScope("c")} AND NOT EXISTS (SELECT 1 FROM sign_offs WHERE job_id = j.id OR id = ?))`,
    params: [body.expectedRevision ?? null, body.expectedRevision ?? null, termsHash, id] },
    writes(guard) {
      const signals = billSignals(billingAccess, guard, candidate, issuedBillNotice, `bill-issue:${billId}`, true);
      return { ...signals, statements: [scopedStatement(access, `INSERT INTO sign_offs (id, job_id, completion_id, approver_id, grant_id, terms_hash, at)
          SELECT ?, j.id, ${resultId}, scope.account_id, (${signOffGrant("scope.account_id")}), ?, ${at}
          FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${guard.sql}`, id, termsHash, ...guard.params ?? []),
        scopedStatement(clock, `, bill_basis AS MATERIALIZED (
          SELECT j.id AS job_id, j.business_id, c.bill_reference_hint AS number, c.bill_amount_minor AS total,
            (${approvedInvoice("c.submitted_at")}) AS approved, ${calendarDeadline(at, AFTERCARE_TARGETS.billDueCalendarDays)} AS due
          FROM aftercare_job j JOIN completions c ON c.id = ${resultId} AND c.state = 'signed_off'
          WHERE ${guard.sql} AND EXISTS (${billingGrantFor("c.bill_hint_by", "g.id = c.bill_hint_grant_id")})
            AND NOT EXISTS (SELECT 1 FROM bills b WHERE (b.job_id = j.id AND b.state = 'issued')
              OR (b.business_id = j.business_id AND b.number = c.bill_reference_hint AND b.version = 1))
        ) INSERT INTO bills (id, job_id, business_id, number, version, net_minor, tax_minor, total_minor, currency,
          line_items, issued_at, due_at, state)
          SELECT ${candidate}, job_id, business_id, number, 1, approved ->> 'net', approved ->> 'tax', total, 'EUR',
            approved ->> 'lines', ${at}, due, 'issued' FROM bill_basis
          WHERE due IS NOT NULL AND (approved ->> 'net') >= 0 AND (approved ->> 'tax') >= 0
            AND total = (approved ->> 'net') + (approved ->> 'tax')`, ...guard.params ?? []),
        updateRevision(access, guard, true), disablePending(access, guard), ...signals.statements] };
    },
  }, completionValue("scope", resultId), body.expectedRevision);
}

export function returnCompletion(ctx: RequestScope, session: SessionAccess, { params, body }: Return) {
  const access = resultAccess(aftercareAccess(session, ctx.now, params.id, true), params.id);
  return aftercareReceipt(ctx, access, {
    access, operationId: body.operationId, command: "completion.return", input: [params.id, body], resultRef: params.id,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE ${foreman("scope")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN completions c ON c.job_id = j.id AND c.id = ${resultId}
      WHERE j.state = 'open' AND c.state = 'submitted' AND j.revision = ?)`, params: [body.expectedRevision] },
    writes(guard) {
      return { statements: [scopedStatement(access, `UPDATE completions SET state = 'returned' WHERE id = ${resultId} AND ${guard.sql}`,
        ...guard.params ?? []), updateRevision(access, guard), disablePending(access, guard)], changes: scopedStatement(access, jobChanges) };
    },
  }, completionValue("scope", resultId, "returned"), body.expectedRevision);
}

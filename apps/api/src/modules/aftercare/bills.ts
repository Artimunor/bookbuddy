import type {
  RouteResponse, confirmNoFundsRoute, correctPaymentRoute, deferCollectionRoute, getJobBillRoute,
  issueBillRoute, recordCheckingRoute, recordPaidRoute, releaseDeferralRoute,
} from "@bookbuddy/api-contract";
import { AFTERCARE_TARGETS } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import type { OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { registerLinkResolver } from "../links";
import type { LinkResolver } from "../links";
import { mayReadCase, mayUseCasePacket } from "./cases";
import { aftercareAccess, aftercareJobValue, aftercareReceipt, calendarDeadline, jobSource, nameOf, withAftercareSiteClock } from "./completion";
import { approvedInvoice, billReferenceReserved, billSignals, customerBillReader, foremanBillReader, invoiceLine, invoiceLines, issuedBillNotice, paymentHead, providerBillReader } from "./invoice";

type ReadBill = RouteResponse<typeof getJobBillRoute.input>;
type IssueBill = RouteResponse<typeof issueBillRoute.input>;
type PaymentInput = RouteResponse<typeof recordPaidRoute.input | typeof correctPaymentRoute.input
  | typeof recordCheckingRoute.input | typeof confirmNoFundsRoute.input>;
type Defer = RouteResponse<typeof deferCollectionRoute.input>;
type Release = RouteResponse<typeof releaseDeferralRoute.input>;
type BillingCapability = "issue_bill" | "record_paid" | "billing_deferral";

const visible = (s: string) => `(${customerBillReader(s)} OR ${foremanBillReader(s)} OR ${providerBillReader(s)})`;
const namedGrant = (s: string, capability: BillingCapability) => `SELECT g.id FROM business_grants g
  WHERE ${providerBillReader(s)} AND g.business_id = j.business_id AND g.membership_id = ${s}.membership_id
    AND g.capability = '${capability}' AND ${liveTerm("g")} ORDER BY g.valid_from DESC, g.id LIMIT 1`;
const flag = (sql: string) => `json(CASE WHEN ${sql} THEN 'true' ELSE 'false' END)`;
const rows = (sql: string) => `(SELECT json_group_array(json(value)) FROM (${sql}))`;
const revisionMatches = "((SELECT revision FROM bill_input) IS NULL OR j.revision = (SELECT revision FROM bill_input))";
const billId = "(SELECT id FROM bill_input)";
const openDeferral = (bill: string) => `SELECT d.id FROM bill_deferrals d
  WHERE d.bill_id = ${bill}.id AND d.released_at IS NULL`;

const signOff = `(SELECT json_object('id', s.id, 'completionId', c.id, 'completionVersion', c.no,
  'quoteVersionId', c.base_quote_version_id, 'termsHash', s.terms_hash, 'at', s.at, 'actorDisplayName', ${nameOf("s.approver_id")})
  FROM sign_offs s JOIN completions c ON c.id = s.completion_id WHERE s.job_id = j.id AND s.at <= ${at})`;
const billSummary = (b: string) => `json_object('id', ${b}.id, 'number', ${b}.number, 'version', ${b}.version,
  'state', ${b}.state, 'replacesId', ${b}.replaces_id, 'netMinor', ${b}.net_minor, 'taxMinor', ${b}.tax_minor,
  'totalMinor', ${b}.total_minor, 'currency', ${b}.currency, 'issuedAt', ${b}.issued_at, 'dueAt', ${b}.due_at)`;
const paymentStamp = (p: string, withReference: boolean) => `CASE WHEN ${p}.id IS NOT NULL THEN json_patch(
  json_object('id', ${p}.id, 'priorId', ${p}.prior_id, 'at', ${p}.at, 'kind', ${p}.kind,
    'actorDisplayName', ${nameOf(`${p}.actor_id`)}, 'actorRole', 'provider_admin'),
  CASE ${p}.kind WHEN 'matched' THEN json_object('amountMinor', ${p}.amount_minor,
    'corrected', ${flag(`EXISTS (SELECT 1 FROM paid_records next WHERE next.prior_id = ${p}.id AND next.kind = 'corrected')`)}
    ${withReference ? `, 'verifiedReference', ${p}.verified_reference` : ""})
  WHEN 'refund_recorded' THEN json_object('amountMinor', ${p}.amount_minor
    ${withReference ? `, 'verifiedReference', ${p}.verified_reference` : ""})
  ELSE json_object('reason', ${p}.reason) END) END`;
const stamp = (p: string, withReference: boolean) => `CASE WHEN ${p}.kind = 'refund_recorded'
  THEN json_set(${paymentStamp(p, withReference)}, '$.reason', ${p}.reason) ELSE ${paymentStamp(p, withReference)} END`;
const due = (p: string) => `(${p}.kind IS NULL OR ${p}.kind = 'no_funds_received')`;
const transitions = {
  matched: "p.kind IS NULL OR p.kind IN ('checking', 'corrected', 'no_funds_received', 'refund_recorded')",
  corrected: "p.kind = 'matched'",
  checking: "p.kind IS NULL OR p.kind = 'no_funds_received'",
  no_funds_received: "p.kind IN ('checking', 'corrected')",
} as const;
type PaymentKind = keyof typeof transitions;
const acceptsPayment = (kind: PaymentKind) => `${kind === "corrected" ? "1" : "b.state = 'issued'"} AND (${transitions[kind]})`;
const deferral = (scope: string) => `json_object('id', d.id, 'caseId', (SELECT pc.id FROM problem_cases pc
  WHERE pc.id = d.case_id AND ${mayReadCase(scope)}), 'amountMinor', d.amount_minor,
  'reviewAt', d.review_at, 'at', d.at, 'actorDisplayName', ${nameOf("d.actor_id")})`;
const activeDispute = `pc.job_id = b.job_id AND (pc.bill_id IS NULL OR pc.bill_id = b.id) AND pc.state IN ('open', 'awaiting_plan')
  AND pc.opened_at <= ${at}`;
const disputedLines = "line.bill_id = b.id AND line.case_id = pc.id";

function billValue(s: string, selection: string): string {
  const history = (withReference: boolean) => rows(`SELECT ${stamp("h", withReference)} AS value FROM history h ORDER BY h.depth DESC`);
  const r = `(${selection})`;
  return `(WITH RECURSIVE chosen AS MATERIALIZED (
    SELECT b.* FROM bills b WHERE b.job_id = j.id AND b.issued_at <= ${at}
      AND CASE WHEN ${r} IS NULL THEN b.state = 'issued' ELSE b.id = ${r} END
  ), history AS (
    SELECT p.*, 0 AS depth FROM chosen b JOIN paid_records p ON p.id = (${paymentHead("b")})
    UNION ALL SELECT prior.*, next.depth + 1 FROM history next JOIN paid_records prior ON prior.id = next.prior_id
  ), packet AS (
    SELECT json_set(${billSummary("b")}, '$.outcome', json_object('status', CASE WHEN ${due("p")} THEN 'due'
      WHEN p.kind = 'matched' THEN 'paid' ELSE 'checking' END, 'record', json(${stamp("p", false)})),
      '$.activeDeferral', json(CASE WHEN b.state = 'issued' AND ${due("p")} AND d.id IS NOT NULL THEN ${deferral(s)} END)) AS core,
      b.*, p.kind AS head_kind, d.amount_minor AS deferred_minor,
      EXISTS (${namedGrant(s, "record_paid")}) AS can_record, EXISTS (${namedGrant(s, "billing_deferral")}) AS can_defer,
      json_object('recordPaid', ${flag(acceptsPayment("matched"))}, 'correctPayment', ${flag(acceptsPayment("corrected"))},
        'recordChecking', ${flag(acceptsPayment("checking"))}, 'confirmNoFunds', ${flag(acceptsPayment("no_funds_received"))}) AS payment_actions
    FROM chosen b LEFT JOIN history p ON p.depth = 0 LEFT JOIN bill_deferrals d ON d.id = (${openDeferral("b")})
  ) SELECT CASE WHEN ${s}.role = 'customer' THEN json_set(base, '$.priorBills', json(${rows(`SELECT ${billSummary("old")} AS value
      FROM bills old WHERE old.job_id = j.id AND old.state <> 'issued' AND old.issued_at <= ${at} ORDER BY old.version DESC`)})) ELSE base END
  FROM (SELECT json_object('audience', ${s}.role, 'job', ${aftercareJobValue}, 'signOff', json(${signOff}), 'bill', json((
    SELECT CASE ${s}.role WHEN 'foreman' THEN b.core WHEN 'provider_admin' THEN json_set(b.core,
      '$.actions', json_set(CASE WHEN b.can_record THEN b.payment_actions ELSE
        '{"recordPaid":false,"correctPayment":false,"recordChecking":false,"confirmNoFunds":false}' END,
        '$.deferCollection', ${flag(`b.can_defer AND b.state = 'issued' AND (b.head_kind IS NULL OR b.head_kind = 'no_funds_received')
          AND b.deferred_minor IS NULL AND EXISTS (SELECT 1 FROM problem_cases pc WHERE ${activeDispute} AND ${mayUseCasePacket(s)}
            AND EXISTS (SELECT 1 FROM bill_disputed_lines line WHERE ${disputedLines} AND line.amount_minor > 0))`)},
        '$.releaseDeferral', ${flag("b.can_defer AND b.deferred_minor IS NOT NULL")}),
      '$.history', json(CASE WHEN b.can_record THEN ${history(true)} ELSE '[]' END),
      '$.deferrals', json(CASE WHEN b.can_defer THEN ${rows(`SELECT json_set(${deferral(s)}, '$.basis', d.basis,
        '$.affectedLineNos', json(d.affected_line_nos), '$.release', json(CASE WHEN d.released_at IS NOT NULL THEN json_object(
          'at', d.released_at, 'actorDisplayName', ${nameOf("d.released_by")}, 'disposition', d.disposition) END)) AS value
        FROM bill_deferrals d WHERE d.bill_id = b.id ORDER BY d.at, d.id`)} ELSE '[]' END))
    ELSE json_set(b.core, '$.lines', json(${rows(`SELECT json_set(${invoiceLine("line.value")}, '$.lineNo', line.key + 1, '$.labelReading', NULL) AS value
      FROM json_each(b.line_items) line ORDER BY line.key`)}), '$.documentUrl', NULL,
      '$.matchesApprovedScope', ${flag(`b.line_items = json_extract((${approvedInvoice("b.issued_at")}), '$.lines')`)},
      '$.paymentInstructions', json(CASE WHEN b.state = 'issued' AND (b.head_kind IS NULL OR b.head_kind = 'no_funds_received')
        AND coalesce(b.deferred_minor, 0) < b.total_minor THEN b.payment_instructions END),
      '$.history', json(${history(false)}), '$.openCases', json(${rows(`SELECT json_object('id', pc.id, 'reference', pc.reference,
        'state', pc.state) AS value FROM problem_cases pc WHERE pc.job_id = j.id AND pc.bill_id = b.id
        AND pc.state IN ('open', 'awaiting_plan') AND pc.reporter_id = ${s}.account_id ORDER BY pc.opened_at, pc.id`)})) END
    FROM packet b))) AS base)
  WHERE ${r} IS NULL OR EXISTS (SELECT 1 FROM chosen))`;
}

export function readBill(session: SessionAccess, now: number, { params, query }: ReadBill) {
  const access = aftercareAccess(session, now, params.j);
  return scopedStatement(access, `, bill_input(id) AS (VALUES (?))
    SELECT (SELECT ${billValue("scope", billId)} FROM aftercare_job j CROSS JOIN aftercare_actor scope
      WHERE ${visible("scope")}) AS value FROM acting_session`, query?.versionId ?? null);
}

const notices = {
  issue: issuedBillNotice, matched: "bill_paid", corrected: "bill_checking", checking: "bill_checking",
  no_funds_received: "bill_due", defer: "bill_collection_deferred", release: "bill_collection_released",
} as const;
const billLink: LinkResolver = {
  targetKind: "bill",
  project(resource, s) {
    return `(SELECT json_object('kind', 'bill', 'bill', json(${billValue(s, resource)}))
      FROM (${jobSource(`j.id = (SELECT job_id FROM bills WHERE id = ${resource})`)}) j WHERE ${customerBillReader(s)})`;
  },
};
for (const kind of new Set(Object.values(notices))) registerLinkResolver(kind, billLink);

function billAccess(session: SessionAccess, now: number, id: string, revision: number | undefined, jobId?: string): SessionAccess {
  const base = jobId === undefined ? accessClock(session, now) : aftercareAccess(session, now, jobId);
  return { sql: `${base.sql}, bill_input(id, revision) AS (VALUES (?, ?))${jobId === undefined ? `,
    aftercare_job AS MATERIALIZED (${jobSource(`j.id = (SELECT job_id FROM bills WHERE id = ${billId})`)}),
    aftercare_actor AS MATERIALIZED (SELECT s.*, ${currentMembership("s", at)} AS membership_id FROM live_scope s)` : ""}`,
  params: [...base.params, id, revision ?? null] };
}

function billingReceipt(ctx: RequestScope, access: SessionAccess, spec: Omit<OperationSpec, "authorize">,
  capability: BillingCapability, expected: number | undefined) {
  return aftercareReceipt(ctx, access, { ...spec,
    authorize: { sql: `EXISTS (SELECT 1 FROM aftercare_job j WHERE EXISTS (${namedGrant("scope", capability)}))` },
  }, billValue("scope", billId), expected);
}

const mayCloseJob = `state = 'open' AND EXISTS (SELECT 1 FROM sign_offs WHERE job_id = jobs.id AND at <= ${at})`;
const mayReopenJob = `state = 'closed' AND EXISTS (SELECT 1 FROM bills b WHERE b.id = ${billId} AND b.state = 'issued')`;
const reviseJob = (access: SessionAccess, guard: CommandStatement, kind?: PaymentKind) => scopedStatement(access,
  `UPDATE jobs SET revision = revision + 1${kind === "matched"
    ? `, state = CASE WHEN ${mayCloseJob} THEN 'closed' ELSE state END, closed_at = CASE WHEN ${mayCloseJob} THEN ${at} ELSE closed_at END`
    : kind === "corrected"
    ? `, state = CASE WHEN ${mayReopenJob} THEN 'open' ELSE state END, closed_at = CASE WHEN ${mayReopenJob} THEN NULL ELSE closed_at END` : ""}
    WHERE id = (SELECT id FROM aftercare_job) AND ${guard.sql}`, ...guard.params ?? []);

export function issueBill(ctx: RequestScope, session: SessionAccess, { params, body }: IssueBill) {
  const { id, number, providerDocumentRef, replacesId, dueAt, paymentInstructions, lines } = body.payload;
  const base = billAccess(session, ctx.now, id, body.expectedRevision, params.j);
  const clock = dueAt === undefined && replacesId === null ? withAftercareSiteClock(base, ctx.now) : base;
  const inputs = { sql: `${clock.sql}, invoice_input(replaces_id, number, document_ref, instructions, due_at) AS (VALUES (?, ?, ?, ?, ?)),
    invoice AS MATERIALIZED (SELECT (${approvedInvoice(at)}) AS approved, i.*,
      coalesce(prev.version + 1, 1) AS version,
      coalesce(i.due_at, prev.due_at${dueAt === undefined && replacesId === null ? `, ${calendarDeadline(at, AFTERCARE_TARGETS.billDueCalendarDays)}` : ""}) AS due
      FROM aftercare_job j CROSS JOIN invoice_input i LEFT JOIN bills prev ON prev.id = i.replaces_id AND prev.job_id = j.id)`,
  params: [...clock.params, replacesId, number, providerDocumentRef, JSON.stringify(paymentInstructions), dueAt ?? null] };
  const asserted = JSON.stringify(lines.map(({ originalLabel, originalLanguage, netMinor, taxMinor }) => ({ originalLabel, originalLanguage, netMinor, taxMinor })));
  return billingReceipt(ctx, base, {
    access: inputs, operationId: body.operationId, command: "bill.issue", input: [params.j, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j CROSS JOIN invoice i
      LEFT JOIN bills prev ON prev.job_id = j.id AND prev.state = 'issued' LEFT JOIN paid_records p ON p.id = (${paymentHead("prev")})
      WHERE ${revisionMatches} AND j.state = 'open' AND i.replaces_id IS prev.id AND i.due >= ${at}
        AND ${invoiceLines("i.approved -> 'lines'")} = ? AND i.approved ->> 'net' >= 0 AND i.approved ->> 'tax' >= 0
        AND (i.approved ->> 'net') + (i.approved ->> 'tax') > 0 AND NOT EXISTS (
          SELECT 1 FROM bills b WHERE b.id = ${billId} OR (b.business_id = j.business_id AND b.number = i.number AND b.version = i.version))
        AND (i.version <> 1 OR NOT (${billReferenceReserved("i.number")}))
        AND (prev.id IS NULL OR (prev.issued_at <= ${at} AND ${due("p")} AND NOT EXISTS (${openDeferral("prev")})
          AND (i.number <> prev.number OR i.document_ref IS NOT prev.provider_document_ref OR i.instructions IS NOT prev.payment_instructions
            OR i.due <> prev.due_at OR i.approved ->> 'lines' <> prev.line_items))))`, params: [asserted] },
    writes(guard) {
      const signals = billSignals(base, guard, billId, notices.issue, `bill-issue:${id}`);
      return { ...signals, statements: [
        ...(replacesId === null ? [] : [{ sql: `UPDATE bills SET state = 'replaced' WHERE id = ? AND ${guard.sql}`, params: [replacesId, ...guard.params ?? []] }]),
        scopedStatement(inputs, `INSERT INTO bills (id, job_id, business_id, number, version, replaces_id, net_minor, tax_minor,
          total_minor, currency, provider_document_ref, payment_instructions, line_items, issued_at, due_at, state)
          SELECT ${billId}, j.id, j.business_id, i.number, i.version,
            i.replaces_id, i.approved ->> 'net', i.approved ->> 'tax', (i.approved ->> 'net') + (i.approved ->> 'tax'), 'EUR',
            i.document_ref, i.instructions, i.approved ->> 'lines', ${at}, i.due, 'issued'
          FROM aftercare_job j CROSS JOIN invoice i WHERE ${guard.sql}`, ...guard.params ?? []),
        reviseJob(base, guard), ...signals.statements,
      ] };
    },
  }, "issue_bill", body.expectedRevision);
}

export function changeBillPayment(ctx: RequestScope, session: SessionAccess, { params, body }: PaymentInput, kind: PaymentKind) {
  const { id, expectedPriorId } = body.payload;
  const amountMinor = "amountMinor" in body.payload ? body.payload.amountMinor : null;
  const verifiedReference = "verifiedReference" in body.payload ? body.payload.verifiedReference : null;
  const reason = "reason" in body.payload ? body.payload.reason : null;
  const access = billAccess(session, ctx.now, params.id, body.expectedRevision);
  return billingReceipt(ctx, access, {
    access, operationId: body.operationId, command: `bill.${kind}`, input: [params.id, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN bills b ON b.id = ${billId}
      LEFT JOIN paid_records p ON p.id = (${paymentHead("b")}) WHERE ${revisionMatches}
      AND b.issued_at <= ${at} AND (p.at IS NULL OR p.at <= ${at}) AND p.id IS ? AND ${acceptsPayment(kind)}
      ${kind === "matched" ? "AND b.total_minor = ?" : ""} AND NOT EXISTS (SELECT 1 FROM paid_records WHERE id = ?))`,
    params: [expectedPriorId, ...(kind === "matched" ? [amountMinor] : []), id] },
    writes(guard) {
      const signals = billSignals(access, guard, billId, notices[kind], `bill-payment:${id}`);
      return { ...signals, statements: [scopedStatement(access, `INSERT INTO paid_records
        (id, bill_id, actor_id, kind, prior_id, amount_minor, verified_reference, reason, at)
        SELECT ?, ${billId}, scope.account_id, '${kind}', ?, ?, ?, ?, ${at} FROM aftercare_actor scope WHERE ${guard.sql}`,
      id, expectedPriorId, amountMinor, verifiedReference, reason, ...guard.params ?? []), reviseJob(access, guard, kind), ...signals.statements] };
    },
  }, "record_paid", body.expectedRevision);
}

export function deferCollection(ctx: RequestScope, session: SessionAccess, { params, body }: Defer) {
  const { id, caseId, expectedPriorId, amountMinor, basis, reviewAt, affectedLineNos } = body.payload;
  const access = billAccess(session, ctx.now, params.id, body.expectedRevision);
  const lineNos = JSON.stringify(affectedLineNos);
  return billingReceipt(ctx, access, {
    access, operationId: body.operationId, command: "bill.defer_collection", input: [params.id, body], resultRef: id,
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN bills b ON b.id = ${billId} JOIN problem_cases pc ON pc.id = ?
      LEFT JOIN paid_records p ON p.id = (${paymentHead("b")}) WHERE ${revisionMatches} AND b.state = 'issued' AND b.issued_at <= ${at}
      AND p.id IS ? AND ${due("p")} AND ${activeDispute} AND ${mayUseCasePacket("scope")} AND ? > ${at}
      AND NOT EXISTS (SELECT 1 FROM bill_deferrals d WHERE d.id = ? OR (d.bill_id = b.id AND d.released_at IS NULL))
      AND ? <= min(b.total_minor, (SELECT sum(line.amount_minor)
        FROM json_each(?) selected LEFT JOIN bill_disputed_lines line ON ${disputedLines} AND line.line_no = selected.value
        HAVING count(line.line_no) = count(*))))`, params: [caseId, expectedPriorId, reviewAt, id, amountMinor, lineNos] },
    writes(guard) {
      const signals = billSignals(access, guard, billId, notices.defer, `bill-deferral:${id}`);
      return { ...signals, statements: [scopedStatement(access, `INSERT INTO bill_deferrals
        (id, job_id, bill_id, case_id, actor_id, grant_id, amount_minor, basis, affected_line_nos, at, review_at)
        SELECT ?, j.id, ${billId}, ?, scope.account_id, (${namedGrant("scope", "billing_deferral")}), ?, ?, ?, ${at}, ?
        FROM aftercare_job j CROSS JOIN aftercare_actor scope WHERE ${guard.sql}`,
      id, caseId, amountMinor, basis, lineNos, reviewAt, ...guard.params ?? []), reviseJob(access, guard), ...signals.statements] };
    },
  }, "billing_deferral", body.expectedRevision);
}

export function releaseDeferral(ctx: RequestScope, session: SessionAccess, { params, body }: Release) {
  const { deferralId, disposition } = body.payload;
  const access = billAccess(session, ctx.now, params.id, body.expectedRevision);
  return billingReceipt(ctx, access, {
    access, operationId: body.operationId, command: "bill.release_deferral", input: [params.id, body], resultRef: deferralId,
    eligible: { sql: `EXISTS (SELECT 1 FROM aftercare_job j JOIN bill_deferrals d ON d.bill_id = ${billId}
      WHERE ${revisionMatches} AND d.id = ? AND d.released_at IS NULL AND d.at <= ${at})`, params: [deferralId] },
    writes(guard) {
      const signals = billSignals(access, guard, billId, notices.release, `bill-deferral-released:${deferralId}`);
      return { ...signals, statements: [scopedStatement(access, `UPDATE bill_deferrals SET disposition = ?, released_at = ${at},
        released_by = (SELECT account_id FROM aftercare_actor), release_grant_id = (SELECT (${namedGrant("scope", "billing_deferral")})
          FROM aftercare_job j CROSS JOIN aftercare_actor scope)
        WHERE id = ? AND ${guard.sql}`, disposition, deferralId, ...guard.params ?? []), reviseJob(access, guard), ...signals.statements] };
    },
  }, "billing_deferral", body.expectedRevision);
}

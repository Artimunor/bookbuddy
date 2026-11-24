import type { CommandStatement } from "../../db/commit";
import type { OperationWrites } from "../../db/operations";
import { at, liveTerm, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { customer, foreman } from "../commercial/policy";
import { createLinkedNotifications } from "../links/notifications";
import { placeCapability } from "../places/policy";

export const issuedBillNotice = "bill_issued";
export const providerBillReader = (s: string) => `(${s}.role = 'provider_admin' AND ${s}.business_id = j.business_id AND ${s}.membership_id IS NOT NULL)`;
export const foremanBillReader = (s: string) => `(${foreman(s)} OR (${s}.role = 'foreman' AND ${s}.business_id = j.business_id
  AND EXISTS (SELECT 1 FROM job_grants g WHERE g.job_id = j.id AND g.context_id = ${s}.context_id AND g.capability = 'backup' AND ${liveTerm("g")})
  AND EXISTS (SELECT 1 FROM business_grants g WHERE g.business_id = j.business_id AND g.membership_id = ${s}.membership_id
    AND g.capability = 'backup_foreman' AND ${liveTerm("g")})))`;
export const customerBillReader = (s: string) => `(${customer(s)} AND ${placeCapability("j.place_id", `${s}.account_id`, "bill_view")})`;

export const paymentHead = (bill: string) => `SELECT p.id FROM paid_records p WHERE p.bill_id = ${bill}.id
  AND NOT EXISTS (SELECT 1 FROM paid_records successor WHERE successor.prior_id = p.id)`;

// Keep each issued line's commercial identity beside its immutable money and text.
export const approvedInvoice = (cutoff: string) => `SELECT json_object('lines', json_group_array(json_object(
    'originalLabel', original_label, 'originalLanguage', original_locale, 'netMinor', net_minor, 'taxMinor', tax_minor,
    'scope', json(CASE rank WHEN 0 THEN json_object('quoteVersionId', version_id, 'lineNo', line_no)
      ELSE json_object('changeVersionId', version_id, 'lineNo', line_no) END))
    ORDER BY rank, approved_at, version_id, line_no), 'net', sum(net_minor), 'tax', sum(tax_minor))
  FROM (
    SELECT 0 AS rank, a.at AS approved_at, q.id AS version_id, i.line_no, i.original_label, q.original_locale, i.net_minor, i.tax_minor
    FROM quote_versions q JOIN approvals a ON a.quote_version_id = q.id AND a.decision = 'approve' AND a.at <= ${cutoff}
    JOIN quote_items i ON i.version_id = q.id WHERE q.job_id = j.id AND q.state = 'approved'
    UNION ALL
    SELECT 1, a.at, v.id, i.line_no, i.original_label, v.original_locale, i.net_minor, i.tax_minor
    FROM change_proposals cp JOIN quote_versions q ON q.id = cp.base_quote_version_id AND q.state = 'approved'
    JOIN change_versions v ON v.proposal_id = cp.id AND v.job_id = cp.job_id AND v.state = 'approved'
    JOIN approvals a ON a.change_version_id = v.id AND a.decision = 'approve' AND a.at <= ${cutoff}
    JOIN change_items i ON i.version_id = v.id WHERE cp.job_id = j.id
  ) approved`;

export const invoiceLine = (value: string) => `json_object('originalLabel', ${value} ->> 'originalLabel',
  'originalLanguage', ${value} ->> 'originalLanguage', 'netMinor', ${value} ->> 'netMinor', 'taxMinor', ${value} ->> 'taxMinor')`;

export const invoiceLines = (items: string) => `(SELECT json_group_array(${invoiceLine("line.value")} ORDER BY line.key)
  FROM json_each(${items}) line)`;

// Only a provider-authorized pending wrap-up reserves a first-version reference.
// Return/supersede releases it; an ordinary foreman's suggestion reserves nothing.
export const billReferenceReserved = (number: string) => `EXISTS (SELECT 1 FROM completions pending
  JOIN jobs other ON other.id = pending.job_id AND other.business_id = j.business_id
  WHERE pending.state = 'submitted' AND pending.bill_hint_grant_id IS NOT NULL
    AND pending.bill_reference_hint = ${number} AND pending.job_id <> j.id
    AND NOT EXISTS (SELECT 1 FROM bills existing WHERE existing.job_id = pending.job_id AND existing.state = 'issued'))`;

const targets = `SELECT c.id AS context_id, c.role, c.account_id, c.business_id, NULL AS membership_id
  FROM aftercare_job j JOIN place_people pp ON pp.place_id = j.place_id AND pp.ends_at IS NULL
  JOIN account_contexts c ON c.account_id = pp.account_id AND c.role = 'customer'
  JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
  UNION ALL
  SELECT c.id, c.role, c.account_id, c.business_id, m.id
  FROM aftercare_job j JOIN businesses b ON b.id = j.business_id AND b.state = 'approved'
  JOIN memberships m ON m.business_id = b.id AND m.state = 'active'
  JOIN membership_roles role ON role.membership_id = m.id AND role.revoked_at IS NULL AND role.granted_at <= ${at}
  JOIN account_contexts c ON c.role_grant_id = role.id AND c.account_id = m.account_id AND c.business_id = b.id AND c.role = role.role
  JOIN accounts a ON a.id = c.account_id AND a.state = 'active' WHERE c.role IN ('provider_admin', 'foreman')`;
const notificationLifetime = `${at} + ${7 * 24 * 60 * 60 * 1_000}`;

// When sign-off does not create the candidate bill, no notification or push is emitted.
export function billSignals(access: SessionAccess, guard: CommandStatement, bill: string, kind: string, event: string,
  signOff = false,
): OperationWrites {
  const destinations = scopedStatement(access, `SELECT ? AS kind, b.id AS resource_id, target.id AS required_scope,
    ${notificationLifetime} AS expires_at, ${at} AS created_at FROM aftercare_job j
    JOIN bills b ON b.id = ${bill} AND b.job_id = j.id
    JOIN account_contexts target ON target.role = 'customer' AND target.account_id IN (j.requester_id, j.named_approver_id)
    JOIN accounts a ON a.id = target.account_id AND a.state = 'active' WHERE ${customerBillReader("target")}`, kind);
  const staff = `${providerBillReader("target")} OR ${foremanBillReader("target")}`;
  return {
    statements: createLinkedNotifications(destinations, guard, event, kind),
    changes: scopedStatement(access, `, targets AS MATERIALIZED (${targets})
      SELECT 'job' AS kind, j.id AS resource_id, target.context_id AS partition_key, 'upsert' AS op, ${at} AS at
      FROM aftercare_job j CROSS JOIN targets target WHERE ${signOff ? `${customer("target")} OR (
        (${staff}) AND (EXISTS (SELECT 1 FROM bills b WHERE b.id = ${bill} AND b.job_id = j.id)
          OR EXISTS (SELECT 1 FROM completions c WHERE c.job_id = j.id AND c.state = 'signed_off' AND c.bill_reference_hint IS NOT NULL)))`
        : `${customerBillReader("target")} OR ${staff}`}
      UNION ALL SELECT 'notification', n.id, n.context_id, 'upsert', ${at} FROM notifications n WHERE n.event_key = ?`, event),
    effects: scopedStatement(access, `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind,
      'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at, ${notificationLifetime} AS expires_at
      FROM notifications n WHERE n.event_key = ? AND n.link_token IS NOT NULL`, event),
  };
}

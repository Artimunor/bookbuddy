import type { EffectHandler } from "../../effects/index";
import { commercialMailKind } from "./signals";

// Resolve the immutable record and the signer's verified mailbox inside the
// consumer's existing claim batch. The ledger stores no email or legal text.
const receipt = `SELECT json_object('id', r.id, 'to', customer.email_normalized, 'reference', j.reference,
  'kind', r.kind, 'at', r.at, 'termsHash', t.hash, 'termsVersion', t.version, 'provider', t.provider_legal_snapshot,
  'terms', t.original_text, 'consent', t.consent_text, 'locale', t.contract_locale,
  'version', coalesce(q.no, ch.no), 'totalMinor', coalesce(q.total_minor, ch.total_minor), 'deltaMinor', ch.delta_minor,
  'scope', coalesce(q.scope, ch.original_text), 'exclusions', q.exclusions, 'timing', ch.timing, 'affectedItems', ch.affected_items,
  'items', json(CASE WHEN q.id IS NOT NULL THEN (SELECT json_group_array(json_object('label', original_label, 'quantity', quantity,
    'net', net_minor, 'tax', tax_minor, 'rule', evidence_rule)) FROM (SELECT * FROM quote_items WHERE version_id = q.id ORDER BY line_no))
    ELSE (SELECT json_group_array(json_object('label', original_label, 'quantity', quantity, 'net', net_minor,
      'tax', tax_minor, 'rule', evidence_rule)) FROM (SELECT * FROM change_items WHERE version_id = ch.id ORDER BY line_no)) END))
  FROM (
    SELECT id, quote_version_id, change_version_id, account_id, terms_hash, decision AS kind, at FROM approvals
    WHERE e.resource_ref GLOB 'decision:*' AND id = substr(e.resource_ref, 10)
    UNION ALL
    SELECT id, quote_version_id, NULL, account_id, terms_hash, kind, at FROM contract_notices
    WHERE e.resource_ref GLOB 'notice:*' AND id = substr(e.resource_ref, 8)
  ) r JOIN accounts customer ON customer.id = r.account_id AND customer.state = 'active' AND customer.verified_at <= r.at
  LEFT JOIN quote_versions q ON q.id = r.quote_version_id LEFT JOIN change_versions ch ON ch.id = r.change_version_id
  JOIN jobs j ON j.id = coalesce(q.job_id, ch.job_id)
  JOIN terms_versions t ON t.id = coalesce(q.terms_id, ch.terms_id) AND t.business_id = j.business_id AND t.hash = r.terms_hash`;

type ReceiptCopy = {
  id: string; to: string; reference: string; kind: keyof typeof titles; at: number; termsHash: string; termsVersion: number;
  provider: string; terms: string; consent: string; locale: string; version: number; totalMinor: number; deltaMinor: number | null;
  scope: string; exclusions: string | null; timing: string | null; affectedItems: string | null;
  items: { label: string; quantity: number; net: number; tax: number; rule: string }[];
};
const titles = {
  approve: { en: "Approval receipt", es: "Justificante de aprobación", pt: "Comprovativo de aprovação" },
  decline: { en: "Decision receipt", es: "Justificante de decisión", pt: "Comprovativo de decisão" },
  early_start_request: { en: "Early-start request received", es: "Solicitud de inicio anticipado recibida", pt: "Pedido de início antecipado recebido" },
  early_start_acknowledgement: { en: "Early-start acknowledgement received", es: "Confirmación de inicio anticipado recibida", pt: "Confirmação de início antecipado recebida" },
  withdrawal: { en: "Withdrawal notice received", es: "Aviso de desistimiento recibido", pt: "Aviso de livre resolução recebido" },
} as const;

export const commercialMailEffect: EffectHandler = {
  kind: commercialMailKind,
  eligible: "e.resource_ref GLOB 'decision:*' OR e.resource_ref GLOB 'notice:*'",
  claimResource: `coalesce((${receipt}), '')`,
  scrub: "resource_ref",
  async prepareMail(_key, { resource_ref }) {
    if (!resource_ref) return null;
    const copy = JSON.parse(resource_ref) as ReceiptCopy;
    const lang = copy.locale.split("-", 1)[0]?.toLowerCase();
    const title = titles[copy.kind][lang === "es" || lang === "pt" ? lang : "en"];
    const amounts = new Intl.NumberFormat(copy.locale, { style: "currency", currency: "EUR" });
    const money = (minor: number) => amounts.format(minor / 100);
    const subject = `BookBuddy ${copy.reference} · ${title}`;
    const text = [title, `${copy.reference} · v${copy.version} · ${copy.id}`, new Date(copy.at).toISOString(), copy.provider,
      copy.scope, copy.exclusions, copy.affectedItems, copy.timing,
      copy.items.map((i) => `${i.quantity} × ${i.label} · ${money(i.net)} + ${money(i.tax)} · ${i.rule}`).join("\n"),
      copy.deltaMinor === null ? null : money(copy.deltaMinor), money(copy.totalMinor),
      `v${copy.termsVersion} · ${copy.termsHash}`, copy.terms, copy.consent].filter(Boolean).join("\n\n");
    return { to: copy.to, subject, text };
  },
};

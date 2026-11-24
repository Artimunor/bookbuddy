import { createOpaqueLink } from "@bookbuddy/api-contract";
import { createPushTranslator } from "@bookbuddy/i18n/push";
import type { Bindings } from "../bindings";
import { at } from "../modules/access/policy";
import { liveContextPredicate } from "../modules/auth/session";
import { noticeLink, pushNoticeAllowed } from "../modules/notifications/policy";
import { createExpoPush, maxReceiptIds } from "../providers/expo-push";
import type { ExpoFetch, ExpoMessage } from "../providers/expo-push";
import type { ClaimedEffect } from ".";

// Notifications are durable recipient intents, not a transport payload. An
// orphaned, read or expired intent, or an installation without a live owner, needs no send.
const input = `FROM notifications n JOIN (
    SELECT c.id AS context_id, c.account_id, c.business_id, c.role, g.membership_id
    FROM account_contexts c JOIN accounts a ON a.id = c.account_id AND a.state = 'active'
    LEFT JOIN membership_roles g ON g.id = c.role_grant_id AND g.granted_at <= ${at}
    WHERE ${liveContextPredicate} AND (c.role = 'customer' OR g.id IS NOT NULL)
  ) scope ON scope.context_id = n.context_id
  JOIN link_targets l ON ${noticeLink}`;
const eligible = `n.id = e.resource_ref AND n.read_at IS NULL AND (${pushNoticeAllowed})`;
const liveInstallations = `FROM push_installations i JOIN sessions owner ON owner.id = i.session_id
  WHERE i.account_id = scope.account_id AND i.state = 'active' AND owner.revoked_at IS NULL AND owner.expires_at > ${at}`;
export const pushNotificationEffect = {
  kind: "notification_push",
  eligible: `EXISTS (SELECT 1 ${input} WHERE ${eligible} AND EXISTS (SELECT 1 ${liveInstallations}))`,
  scrub: "resource_ref", // Retain only the notification ID in the ledger, never a device token.
  claimResource: `coalesce((SELECT json_object('kind', n.kind, 'token', l.token, 'locale', p.ui_locale,
    'installations', json((SELECT json_group_array(json_object('id', i.id, 'epoch', i.token_epoch, 'token', i.token))
      ${liveInstallations})))
    ${input} LEFT JOIN account_preferences p ON p.account_id = scope.account_id WHERE n.id = e.resource_ref), '')`,
} as const;

const receiptDelay = 15 * 60_000;
const maxDueReceipts = 2 * maxReceiptIds;
interface Installation { id: string; epoch: number; token: string }
interface PushInput { kind: string; token: string; locale: string | null; installations: Installation[] }
interface DeviceResult { id: string; epoch: number; effectId: string }
export interface EffectOutcome { id: string; state: "skipped" | "failed" | "delivered" | "unknown" }

export async function dispatchPush(env: Bindings, jobs: readonly ClaimedEffect[], claim: string, now: number, fetcher?: ExpoFetch) {
  const outcomes: EffectOutcome[] = [];
  const messages: ExpoMessage[] = [];
  const deliveries: { installation: Installation; outcome: EffectOutcome }[] = [];
  for (const job of jobs) {
    const outcome: EffectOutcome = { id: job.id, state: "failed" };
    outcomes.push(outcome);
    if (!job.resource_ref) { outcome.state = "skipped"; continue; }
    const { kind, token, locale, installations } = JSON.parse(job.resource_ref) as PushInput;
    if (installations.length === 0) { outcome.state = "skipped"; continue; }
    let url: ExpoMessage["data"]["url"];
    try {
      url = createOpaqueLink(env.PUBLIC_APP_ORIGIN ?? "", token);
    } catch {
      continue; // Fail closed without a valid public HTTPS origin and opaque token.
    }
    const { t } = createPushTranslator(locale);
    const title = t("push.generic.title");
    const body = kind === "cover_offer" ? t("push.coverOffer.body")
      : kind === "place_invite" || kind === "place_transfer" || kind === "invitation" ? t("push.placeInvite.body") : t("push.generic.body");
    const data = { url };
    for (const installation of installations) {
      messages.push({ to: installation.token, title, body, data });
      deliveries.push({ installation, outcome });
    }
  }
  const statements: D1PreparedStatement[] = [];
  if (messages.length === 0) return { outcomes, statements };
  const tickets = await createExpoPush(env.EXPO_ACCESS_TOKEN, fetcher).send(messages);
  const accepted: (DeviceResult & { ticket: string })[] = [];
  const disabled: DeviceResult[] = [];
  for (let i = 0; i < deliveries.length; i++) {
    const { installation, outcome } = deliveries[i]!;
    const ticket = tickets[i];
    if (!ticket || ticket.state === "unknown") {
      outcome.state = "unknown";
    } else if (ticket.state === "accepted") {
      accepted.push({ ticket: ticket.id, id: installation.id, epoch: installation.epoch, effectId: outcome.id });
      if (outcome.state !== "unknown") outcome.state = "delivered";
    } else if (ticket.deviceNotRegistered) {
      disabled.push({ id: installation.id, epoch: installation.epoch, effectId: outcome.id });
    }
  }
  const { DB: db } = env;
  const fenced = `JOIN effect_claims c ON c.effect_id = row.value ->> 'effectId' AND c.claim_id = ? AND c.result_code IS NULL
    JOIN effect_outbox e ON e.id = c.effect_id AND e.state = 'claimed'`;
  if (accepted.length) statements.push(db.prepare(`INSERT INTO push_tickets (id, effect_id, installation_id, token_epoch, next_check_at, state)
    SELECT row.value ->> 'ticket', e.id, row.value ->> 'id', row.value ->> 'epoch', ?, 'due'
    FROM json_each(?) row ${fenced} WHERE 1 ON CONFLICT(id) DO NOTHING`)
    .bind(now + receiptDelay, JSON.stringify(accepted), claim));
  if (disabled.length) statements.push(db.prepare(`UPDATE push_installations SET state = 'disabled', updated_at = ?
    WHERE state = 'active' AND (id, token_epoch) IN (
      SELECT row.value ->> 'id', row.value ->> 'epoch' FROM json_each(?) row ${fenced})`)
    .bind(now, JSON.stringify(disabled), claim));
  return { outcomes, statements };
}

export async function sweepPushReceipts(env: Bindings, now = Date.now(), fetcher?: ExpoFetch): Promise<void> {
  const { DB: db } = env;
  const { results: tickets } = await db.prepare(`SELECT id FROM push_tickets WHERE state = 'due' AND next_check_at <= ?
    ORDER BY next_check_at, id LIMIT ${maxDueReceipts}`).bind(now).all<{ id: string }>();
  if (!tickets.length) return;
  const receipts = await createExpoPush(env.EXPO_ACCESS_TOKEN, fetcher).receipts(tickets.map(({ id }) => id));
  const outcomes = tickets.map(({ id }, i) => {
    const receipt = receipts[i];
    return { id, state: receipt?.state ?? "unknown", disable: receipt?.state === "rejected" && receipt.deviceNotRegistered };
  });
  const statements: D1PreparedStatement[] = [];
  if (outcomes.some(({ disable }) => disable)) statements.push(db.prepare(`UPDATE push_installations SET state = 'disabled', updated_at = ?
    WHERE state = 'active' AND (id, token_epoch) IN (
      SELECT t.installation_id, t.token_epoch FROM push_tickets t JOIN json_each(?) row ON t.id = row.value ->> 'id'
      WHERE t.state = 'due' AND t.next_check_at <= ? AND row.value ->> 'disable' = 1)`)
    .bind(now, JSON.stringify(outcomes.filter(({ disable }) => disable)), now));
  // Receipts are terminal transport evidence; missing/ambiguous is unknown.
  // The same ticket is never polled again and the original alert never retried.
  statements.push(db.prepare(`WITH outcomes AS MATERIALIZED (
      SELECT value ->> 'id' AS id, value ->> 'state' AS state FROM json_each(?))
    UPDATE push_tickets SET state = outcomes.state FROM outcomes
    WHERE push_tickets.id = outcomes.id AND push_tickets.state = 'due' AND push_tickets.next_check_at <= ?`)
    .bind(JSON.stringify(outcomes), now));
  await db.batch(statements);
}

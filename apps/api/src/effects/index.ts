import { invitationMailEffect } from "../modules/access/mail";
import { loadDeliveryKey } from "../modules/auth/crypto";
import { otpEmailEffect } from "../modules/auth/mail-effect";
import type { Bindings } from "../bindings";
import { createMailDelivery } from "../providers/mail";
import type { MailMessage, MailResult } from "../providers/mail";

// Durable intent data stays in D1. Queue wakeups carry keys only.
export interface EffectsWake {
  readonly workKeys: readonly string[];
}

export interface ClaimedEffect { id: string; kind: string; resource_ref: string }
export interface EffectHandler {
  readonly kind: string;
  // Trusted SQL fragments. `eligible` may reference the outbox alias `e`.
  readonly eligible: string;
  readonly scrub: string;
  prepareMail(key: CryptoKey, job: ClaimedEffect): Promise<MailMessage | null>;
}

const handlers: readonly EffectHandler[] = [otpEmailEffect, invitationMailEffect];
const handlersByKind = new Map(handlers.map((handler) => [handler.kind, handler]));
const knownKinds = handlers.map(({ kind }) => `'${kind}'`).join(", ");
const eligible = `CASE e.kind ${handlers.map((h) => `WHEN '${h.kind}' THEN (${h.eligible})`).join(" ")} ELSE 0 END`;
const scrub = `CASE kind ${handlers.map((h) => `WHEN '${h.kind}' THEN (${h.scrub})`).join(" ")} ELSE resource_ref END`;
const maxClaim = 32;
const leaseMs = 60_000;

export async function runEffectBatch(env: Bindings, keys: readonly string[] | null, now = Date.now()): Promise<void> {
  if (keys?.length === 0) return;
  const { DB: db } = env;
  const claim = crypto.randomUUID();
  const target = keys === null
    ? "e.kind IN (" + knownKinds + ")"
    : "e.id IN (SELECT value FROM json_each(?)) AND e.kind IN (" + knownKinds + ")";
  const keyArgs = keys === null ? [] : [JSON.stringify(keys)];
  // Claim + input in one transactional batch. Bound each sweep; pending work
  // left by a missed wake stays in the ledger for the next scheduled pass.
  const [, , , , , claimed] = await db.batch<ClaimedEffect>([
    db.prepare(`UPDATE effect_outbox SET state = 'skipped', resource_ref = ${scrub}
      WHERE id IN (SELECT e.id FROM effect_outbox e WHERE e.state = 'pending' AND ${target}
        AND e.due_at <= ? AND (e.expires_at <= ? OR NOT (${eligible})) ORDER BY e.due_at, e.id LIMIT ${maxClaim})`)
      .bind(...keyArgs, now, now),
    db.prepare(`UPDATE effect_outbox SET state = 'unknown', resource_ref = ${scrub}
      WHERE id IN (SELECT e.id FROM effect_outbox e JOIN effect_claims c ON c.effect_id = e.id
        WHERE e.state = 'claimed' AND ${target} AND c.result_code IS NULL AND c.lease_until <= ?
        ORDER BY e.due_at, e.id LIMIT ${maxClaim})`)
      .bind(...keyArgs, now),
    db.prepare(`UPDATE effect_claims SET result_code = 'unknown'
      WHERE result_code IS NULL AND lease_until <= ? AND effect_id IN (
        SELECT id FROM effect_outbox WHERE state = 'unknown' AND kind IN (${knownKinds})
      )`).bind(now),
    db.prepare(`INSERT INTO effect_claims (effect_id, attempt, claim_id, fence, claimed_at, lease_until)
      SELECT e.id, 1, ?, 1, ?, min(e.expires_at, ?) FROM effect_outbox e
      WHERE e.state = 'pending' AND ${target} AND e.due_at <= ? AND e.expires_at > ? AND (${eligible})
      ORDER BY e.due_at, e.id LIMIT ${maxClaim}`).bind(claim, now, now + leaseMs, ...keyArgs, now, now),
    db.prepare(`UPDATE effect_outbox SET state = 'claimed'
      WHERE state = 'pending' AND id IN (SELECT effect_id FROM effect_claims WHERE claim_id = ?)`).bind(claim),
    db.prepare(`SELECT e.id, e.kind, e.resource_ref FROM effect_claims c JOIN effect_outbox e ON e.id = c.effect_id
      WHERE c.claim_id = ? AND e.state = 'claimed' ORDER BY e.due_at, e.id`).bind(claim),
  ]);
  if (!claimed?.results.length) return;

  const mail = createMailDelivery(env);
  const key = mail && await loadDeliveryKey(env.EFFECTS_ENCRYPTION_KEY);
  const outcomes = claimed.results.map(({ id }) => ({ id, state: "failed" as MailResult }));
  if (mail && key) {
    const messages = (await Promise.all(claimed.results.map(async (job, index) => {
      try {
        const message = await handlersByKind.get(job.kind)?.prepareMail(key, job);
        return message ? { index, message } : null;
      } catch {
        return null;
      }
    }))).filter((entry) => entry !== null);
    if (messages.length) {
      const delivered = await mail.send(messages.map(({ message }) => message));
      for (const [i, { index }] of messages.entries()) outcomes[index]!.state = delivered[i] ?? "unknown";
    }
  }
  const results = JSON.stringify(outcomes);
  // The claim ID and outstanding-result guard fence late responses. A dead
  // process's expired claim becomes unknown, never pending for another send.
  await db.batch([
    db.prepare(`WITH outcomes AS (SELECT value ->> 'id' AS id, value ->> 'state' AS state FROM json_each(?))
      UPDATE effect_outbox SET state = (SELECT state FROM outcomes WHERE id = effect_outbox.id), resource_ref = ${scrub}
      WHERE state = 'claimed' AND id IN (
        SELECT c.effect_id FROM effect_claims c JOIN outcomes o ON o.id = c.effect_id
        WHERE c.claim_id = ? AND c.result_code IS NULL
      )`).bind(results, claim),
    db.prepare(`UPDATE effect_claims SET result_code = (SELECT state FROM effect_outbox WHERE id = effect_id)
      WHERE claim_id = ? AND result_code IS NULL
        AND effect_id IN (SELECT id FROM effect_outbox WHERE state IN ('delivered', 'failed', 'unknown', 'skipped'))`).bind(claim),
  ]);
}

export async function consumeEffects(batch: MessageBatch<EffectsWake>, env: Bindings): Promise<void> {
  const keys = new Set<string>();
  for (const message of batch.messages) {
    for (const key of message.body.workKeys) keys.add(key);
  }
  try {
    await runEffectBatch(env, [...keys]);
    batch.ackAll();
  } catch {
    batch.retryAll();
  }
}

export function sweepDueWork(_controller: ScheduledController, env: Bindings): Promise<void> {
  return runEffectBatch(env, null);
}

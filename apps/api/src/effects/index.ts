import { invitationMailEffect } from "../modules/access/mail";
import { caseSweepStatements, completionSweepStatements } from "../modules/aftercare";
import { loadDeliveryKey } from "../modules/auth/crypto";
import { otpEmailEffect } from "../modules/auth/mail-effect";
import { commercialMailEffect } from "../modules/commercial/mail";
import type { Bindings } from "../bindings";
import { createMailDelivery } from "../providers/mail";
import type { MailMessage, MailResult } from "../providers/mail";
import type { ExpoFetch } from "../providers/expo-push";
import type { TranslationFetch } from "../providers/translate";
import { dispatchPush, pushNotificationEffect, sweepPushReceipts } from "./push";
import { chatTranslationEffect, dispatchTranslation, publishTranslationHints, recoverTranslations } from "./translate";
import type { TranslationThread } from "./translate";

// Durable intent data stays in D1. Queue wakeups carry keys only.
export interface EffectsWake {
  readonly workKeys: readonly string[];
}

export interface ClaimedEffect { id: string; kind: string; resource_ref: string }
type ClaimedRow = ClaimedEffect & { lease_until: number };
type MailOutcome = { id: string } & (MailResult | { state: "skipped" });
interface ClaimDefinition {
  readonly kind: string;
  // Trusted SQL fragments. `eligible` may reference the outbox alias `e`.
  readonly eligible: string;
  readonly scrub: string;
  // Optional projection of a durable reference, loaded in the claim statement.
  readonly claimResource?: string;
}

export interface EffectHandler extends ClaimDefinition {
  prepareMail(key: CryptoKey, job: ClaimedEffect): Promise<MailMessage | null>;
}

const mailHandlers: readonly EffectHandler[] = [otpEmailEffect, invitationMailEffect, commercialMailEffect];
const mailKinds = mailHandlers.map(({ kind }) => `'${kind}'`).join(", ");
const mailByKind = new Map(mailHandlers.map((handler) => [handler.kind, handler]));
const handlers: readonly ClaimDefinition[] = [...mailHandlers, pushNotificationEffect, chatTranslationEffect];
const knownKinds = handlers.map(({ kind }) => `'${kind}'`).join(", ");
const eligible = `CASE e.kind ${handlers.map((h) => `WHEN '${h.kind}' THEN (${h.eligible})`).join(" ")} ELSE 0 END`;
const scrub = `CASE kind ${handlers.map((h) => `WHEN '${h.kind}' THEN (${h.scrub})`).join(" ")} ELSE resource_ref END`;
const claimResource = `CASE e.kind ${handlers.filter((h) => h.claimResource)
  .map((h) => `WHEN '${h.kind}' THEN (${h.claimResource})`).join(" ")} ELSE e.resource_ref END`;
const maxClaim = 32;
const maxMailClaim = 16; // Each intent can make one SEND_EMAIL subrequest.
const maxMailAttempts = 3;
const mailRetryDelayMs = 60_000;
const leaseMs = 60_000;
const effectClock = "WITH clock(at) AS (VALUES (?))";
const claimClock = `${effectClock}, case_steward_config(account_id) AS (VALUES (?))`;

export async function runEffectBatch(env: Bindings, keys: readonly string[] | null, now = Date.now(),
  expoFetch?: ExpoFetch, translationFetch?: TranslationFetch): Promise<void> {
  if (keys?.length === 0) return;
  const { DB: db } = env;
  const claim = crypto.randomUUID();
  const target = keys === null
    ? "e.kind IN (" + knownKinds + ")"
    : "e.id IN (SELECT value FROM json_each(?)) AND e.kind IN (" + knownKinds + ")";
  const keyArgs = keys === null ? [] : [JSON.stringify(keys)];
  const steward = env.CASE_STEWARD_ACCOUNT_ID ?? null;
  // Claim + input in one transactional batch. Bound each sweep; pending work
  // left by a missed wake stays in the ledger for the next scheduled pass.
  const claimResults = await db.batch([
    ...(keys === null ? [...completionSweepStatements(now), ...caseSweepStatements(now, env.CASE_STEWARD_ACCOUNT_ID)]
      .map(({ sql, params }) => db.prepare(sql).bind(...params ?? [])) : []),
    db.prepare(`${claimClock} UPDATE effect_outbox SET state = 'skipped', resource_ref = ${scrub}
      WHERE id IN (SELECT e.id FROM effect_outbox e WHERE e.state = 'pending' AND ${target}
        AND e.due_at <= ? AND (e.expires_at <= ? OR NOT (${eligible})) ORDER BY e.due_at, e.id LIMIT ${maxClaim})`)
      .bind(now, steward, ...keyArgs, now, now),
    db.prepare(`UPDATE effect_outbox SET state = 'unknown', resource_ref = ${scrub}
      WHERE id IN (SELECT e.id FROM effect_outbox e JOIN effect_claims c ON c.effect_id = e.id
        WHERE e.state = 'claimed' AND ${target} AND c.result_code IS NULL AND c.lease_until <= ?
        ORDER BY e.due_at, e.id LIMIT ${maxClaim})`)
      .bind(...keyArgs, now),
    db.prepare(`UPDATE effect_claims SET result_code = 'unknown'
      WHERE result_code IS NULL AND lease_until <= ? AND effect_id IN (
        SELECT id FROM effect_outbox WHERE state = 'unknown' AND kind IN (${knownKinds})
      )`).bind(now),
    recoverTranslations(db, target, keyArgs, 2 * maxClaim),
    db.prepare(`${claimClock}, due AS MATERIALIZED (
        SELECT e.id, e.kind, e.due_at, e.expires_at FROM effect_outbox e
        WHERE e.state = 'pending' AND ${target} AND e.due_at <= ? AND e.expires_at > ? AND (${eligible})
        ORDER BY e.due_at, e.id LIMIT ${maxClaim}
      ), mail_due AS (
        SELECT id FROM due WHERE kind IN (${mailKinds}) ORDER BY due_at, id LIMIT ${maxMailClaim}
      ), attempts AS MATERIALIZED (
        SELECT d.id, d.expires_at, CASE WHEN d.kind IN (${mailKinds}) THEN coalesce((
          SELECT max(c.attempt) FROM effect_claims c WHERE c.effect_id = d.id
        ), 0) + 1 ELSE 1 END AS attempt
        FROM due d WHERE d.kind NOT IN (${mailKinds}) OR d.id IN (SELECT id FROM mail_due)
      )
      INSERT INTO effect_claims (effect_id, attempt, claim_id, fence, claimed_at, lease_until)
      SELECT id, attempt, ?, attempt, ?, min(expires_at, ?) FROM attempts`)
      .bind(now, steward, ...keyArgs, now, now, claim, now, now + leaseMs),
    db.prepare(`UPDATE effect_outbox SET state = 'claimed'
      WHERE state = 'pending' AND id IN (SELECT effect_id FROM effect_claims WHERE claim_id = ?)`).bind(claim),
    db.prepare(`${effectClock} SELECT e.id, e.kind, c.lease_until, ${claimResource} AS resource_ref
      FROM effect_claims c JOIN effect_outbox e ON e.id = c.effect_id
      WHERE c.claim_id = ? AND e.state = 'claimed' ORDER BY e.due_at, e.id`).bind(now, claim),
  ]);
  const claimed = claimResults.at(-1)?.results as ClaimedRow[] | undefined;
  const recovered = claimResults.at(-4)?.results as TranslationThread[] ?? [];
  if (!claimed?.length) {
    if (recovered.length) await publishTranslationHints(env, recovered);
    return;
  }

  const mailJobs: ClaimedRow[] = [], pushJobs: ClaimedEffect[] = [], translationJobs: ClaimedEffect[] = [];
  for (const job of claimed) {
    if (job.kind === chatTranslationEffect.kind) translationJobs.push(job);
    else if (job.kind === pushNotificationEffect.kind) pushJobs.push(job);
    else mailJobs.push(job);
  }
  const [mail, push, translation] = await Promise.all([
    dispatchMail(env, mailJobs),
    dispatchPush(env, pushJobs, claim, now, expoFetch),
    dispatchTranslation(env, translationJobs, claim, translationFetch),
  ]);
  const results = JSON.stringify([...mail, ...push.outcomes, ...translation.outcomes]);
  const retryAt = Date.now() + mailRetryDelayMs;
  // Only a definite refusal may return to pending. A dead process's expired
  // claim becomes unknown and cannot send again, even on queue redelivery.
  const saved = await db.batch([
    ...(translation.statement ? [translation.statement] : []),
    ...push.statements,
    db.prepare(`WITH outcomes AS (SELECT value ->> 'id' AS id, value ->> 'state' AS state FROM json_each(?)),
      settled AS MATERIALIZED (
        SELECT o.id, CASE WHEN o.state <> 'retryable' THEN o.state
          WHEN c.attempt < ${maxMailAttempts} AND e.expires_at > ? THEN 'pending' ELSE 'failed' END AS next_state
        FROM outcomes o JOIN effect_claims c ON c.effect_id = o.id AND c.claim_id = ? AND c.result_code IS NULL
        JOIN effect_outbox e ON e.id = o.id AND e.state = 'claimed'
      )
      UPDATE effect_outbox SET state = settled.next_state,
        due_at = CASE WHEN settled.next_state = 'pending' THEN ? ELSE due_at END,
        resource_ref = CASE WHEN settled.next_state = 'pending' THEN resource_ref ELSE ${scrub} END
      FROM settled WHERE effect_outbox.id = settled.id`).bind(results, retryAt, claim, retryAt),
    db.prepare(`UPDATE effect_claims SET
        result_code = CASE WHEN e.state = 'pending' THEN 'retryable' ELSE e.state END,
        provider_ref = outcome.value ->> 'providerRef'
      FROM json_each(?) outcome JOIN effect_outbox e ON e.id = outcome.value ->> 'id'
      WHERE effect_claims.effect_id = e.id AND claim_id = ? AND result_code IS NULL`).bind(results, claim),
  ]);
  const translated = translation.statement ? saved[0]?.results as TranslationThread[] ?? [] : [];
  if (recovered.length || translated.length) await publishTranslationHints(env, [...recovered, ...translated]);
}

async function dispatchMail(env: Bindings, jobs: readonly ClaimedRow[]): Promise<MailOutcome[]> {
  if (!jobs.length) return [];
  const mail = createMailDelivery(env);
  const key = mail && await loadDeliveryKey(env.EFFECTS_ENCRYPTION_KEY);
  if (!mail || !key) return jobs.map(({ id }) => ({ id, state: "failed" }));
  const outcomes: MailOutcome[] = [];
  // Keep a single mail send in flight alongside the other effect providers.
  for (const job of jobs) {
    const { id, lease_until: deadline } = job;
    if (Date.now() >= deadline) { outcomes.push({ id, state: "skipped" }); continue; }
    let message: MailMessage | null;
    try {
      message = await mailByKind.get(job.kind)!.prepareMail(key, job);
    } catch {
      message = null;
    }
    if (!message) outcomes.push({ id, state: "failed" });
    else if (Date.now() >= deadline) outcomes.push({ id, state: "skipped" });
    else outcomes.push({ id, ...await mail.send(message) });
  }
  return outcomes;
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

export async function sweepDueWork(_controller: ScheduledController, env: Bindings): Promise<void> {
  const now = Date.now();
  await Promise.all([runEffectBatch(env, null, now), sweepPushReceipts(env, now)]);
}

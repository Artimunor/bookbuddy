import type { EmailAttempt, RouteRequest, SessionBootstrap } from "@bookbuddy/api-contract";
import type { emailResendRoute, emailStartRoute, emailVerifyRoute } from "@bookbuddy/api-contract";
import { commitCommand, prepareCommand } from "../../db/commit";
import type { CommandStatement } from "../../db/commit";
import type { RequestScope } from "../../db/scope";
import { isSyntheticMailbox } from "../../providers/mail";
import { loadDeliveryKey, mac, mailboxKey, randomOtp, randomToken, sealDelivery } from "./crypto";
import { otpEmailEffectKind, otpMessage } from "./mail-effect";
import { decodeSession, defaultContextSql, hashSessionCredential, sessionProjection } from "./session";
import type { AuthBindings } from "../../config";

type Start = RouteRequest<typeof emailStartRoute.input>["body"];
type Reissue = RouteRequest<typeof emailResendRoute.input>["body"];
type Verify = RouteRequest<typeof emailVerifyRoute.input>["body"];

const minuteMs = 60_000;
const lifetime = 10 * minuteMs;
const windowMs = 30 * minuteMs;
const lockoutMs = 15 * minuteMs;
const verifyReplayMs = 2 * minuteMs;
const sessionLifetime = 30 * 24 * 60 * minuteMs;

interface Proof { id: string; email: string; device: string; source: string }
type AttemptRow = {
  id: string | null; generation: number; expires_at: number; state: EmailAttempt["state"];
  delivery: string | null; resend_at: number; lock_until: number | null; wrong: number; send_proof: string | null;
};

export type SendResult = { kind: "ok"; attempt: EmailAttempt; workKey?: string }
  | { kind: "locked"; retryAt: number }
  | { kind: "missing" | "stale" | "unavailable" };

type VerifyResult = { kind: "verified"; session: SessionBootstrap; credential: string }
  | { kind: "wrong_code"; triesLeft: number }
  | { kind: "locked"; retryAt: number }
  | { kind: "expired" | "missing" | "consumed" | "denied" };

async function proofFor(key: CryptoKey, token: string, device: Start, source: string | null): Promise<Proof> {
  const [id, email, deviceKey, sourceKey] = await Promise.all([
    mac(key, "otp-attempt", token), mac(key, "otp-email", device.email),
    mac(key, "otp-device", device.deviceId), mac(key, "otp-source", source ?? ""),
  ]);
  return { id, email, device: deviceKey, source: sourceKey };
}

// Count all sends and wrong checks in independent keyed mailbox/device/source
// buckets. Missing Cloudflare source metadata shares a single conservative bucket.
function otpPrefix(now: number, id: string, source: string, proof?: Proof): CommandStatement {
  return {
    params: proof ? [now, id, proof.email, proof.device, proof.email, proof.device, source] : [now, id, source],
    sql: `WITH clock(now) AS (VALUES (?)),
      challenge AS MATERIALIZED (SELECT * FROM otp_attempts WHERE id = ?${proof ? " AND email_key = ? AND device_key = ?" : ""}),
      buckets(kind, key, sends, checks) AS (VALUES
        ('email', ${proof ? "?" : "(SELECT email_key FROM challenge)"}, 3, 5),
        ('device', ${proof ? "?" : "(SELECT device_key FROM challenge)"}, 10, 10),
        ('source', ?, 30, 30)
      ), active_lock AS (
        SELECT max(l.until) AS until FROM buckets b JOIN otp_lockouts l
          ON l.bucket_kind = b.kind AND l.bucket_key = b.key WHERE l.until > (SELECT now FROM clock)
      )`,
  };
}

const nowSql = "(SELECT now FROM clock)";
const sendGate = `, send_gate AS (
  SELECT max(at) AS at FROM (
    SELECT ${nowSql} AS at
    UNION ALL SELECT until FROM active_lock
    UNION ALL SELECT e.at + ${minuteMs} FROM buckets b JOIN otp_events e
      ON e.bucket_kind = b.kind AND e.bucket_key = b.key AND e.kind = 'sent'
      WHERE b.kind = 'email' AND e.at > ${nowSql} - ${minuteMs}
    UNION ALL SELECT min(e.at) + ${windowMs} FROM buckets b JOIN otp_events e
      ON e.bucket_kind = b.kind AND e.bucket_key = b.key AND e.kind = 'sent'
      WHERE e.at > ${nowSql} - ${windowMs} GROUP BY b.kind, b.sends HAVING count(*) >= b.sends
  )
)`;
const wrongCount = `(SELECT count(*) FROM otp_events e JOIN buckets b
  ON b.kind = e.bucket_kind AND b.key = e.bucket_key WHERE b.kind = 'email' AND e.kind = 'verify_failed'
    AND e.at > ${nowSql} - ${windowMs})`;
const workKeySql = "'otp_email:' || a.id || ':' || a.generation";

function selectAttempt(prefix: CommandStatement): CommandStatement {
  return {
    params: prefix.params,
    sql: `${prefix.sql}${sendGate}
      SELECT a.id, a.generation, a.expires_at, a.state, e.state AS delivery, substr(e.resource_ref, 45, 43) AS send_proof,
             (SELECT at FROM send_gate) AS resend_at, (SELECT until FROM active_lock) AS lock_until, ${wrongCount} AS wrong
      FROM clock LEFT JOIN challenge a ON 1 LEFT JOIN effect_outbox e ON e.dedupe_key = ${workKeySql}`,
  };
}

function projectAttempt(row: AttemptRow, token: string, now: number): EmailAttempt {
  const state = row.state === "consumed" || row.state === "invalidated" ? row.state
    : row.lock_until !== null ? "locked" : row.state === "expired" || row.expires_at <= now ? "expired" : "pending";
  return {
    attemptId: token, generation: row.generation, state, expiresAt: row.expires_at, resendAt: row.resend_at,
    retryAt: row.lock_until, triesLeft: row.lock_until === null ? Math.max(1, 5 - row.wrong) : 0,
    delivery: row.delivery === "delivered" ? "accepted" : row.delivery === "unknown" ? "unknown"
      : row.delivery === "failed" || row.delivery === "skipped" ? "failed" : "requested",
  };
}

export async function getOtpStatus(ctx: RequestScope, key: CryptoKey, token: string, source: string | null): Promise<EmailAttempt | null> {
  const [id, sourceKey] = await Promise.all([mac(key, "otp-attempt", token), mac(key, "otp-source", source ?? "")]);
  const command = selectAttempt(otpPrefix(ctx.now, id, sourceKey));
  const row = await ctx.binding.prepare(command.sql).bind(...command.params ?? []).first<AttemptRow>();
  return row?.id ? projectAttempt(row, token, ctx.now) : null;
}

interface DeliveryOptions { source: string | null; language?: string; local: boolean; bindings: AuthBindings }

export async function sendOtp(ctx: RequestScope, key: CryptoKey, input: Start, options: DeliveryOptions, reissue?: {
  token: string; revision: number; operationId: string;
}): Promise<SendResult> {
  const deliveryKey = await loadDeliveryKey(options.bindings.EFFECTS_ENCRYPTION_KEY);
  if (!deliveryKey) return { kind: "unavailable" };
  const now = ctx.now;
  const token = reissue?.token ?? input.attemptId ?? randomToken();
  const proof = await proofFor(key, token, input, options.source);
  const next = reissue ? reissue.revision + 1 : 1;
  const effectId = crypto.randomUUID();
  const dedupeKey = `otp_email:${proof.id}:${next}`;
  const testCode = options.bindings.OTP_DEV_TEST_CODE;
  const synthetic = options.local && options.bindings.OTP_MAIL_DEV === "true" && options.bindings.OTP_DEV_LOG_CODE === "true"
    && isSyntheticMailbox(input.email) && testCode !== undefined && /^\d{6}$/.test(testCode);
  const fixtureCode = synthetic ? Number(testCode) : 0;
  const code = synthetic ? String((fixtureCode + next - 1) % 1_000_000).padStart(6, "0") : randomOtp();
  // Choose the fallback in SQL if the new random value would reproduce the
  // previous code. This avoids a preflight read and makes invalidation exact.
  const fallback = reissue ? synthetic ? String((fixtureCode + next) % 1_000_000).padStart(6, "0") : randomOtp(code) : code;
  const codeMac = (value: string) => mac(key, "otp-code", proof.id, proof.email, input.transport, value);
  const seal = (value: string) => sealDelivery(deliveryKey, effectId, otpMessage(input.email, value, synthetic, options.language));
  const [sendProof, pendingCode, encrypted, previousTransportMac, fallbackCode, fallbackEncrypted] = await Promise.all([
    mac(key, "otp-send", proof.id, proof.email, proof.device, input.transport, next, reissue?.operationId ?? ""),
    codeMac(code), seal(code),
    reissue ? mac(key, "otp-code", proof.id, proof.email, input.transport === "web" ? "native" : "web", code) : null,
    reissue ? codeMac(fallback) : null, reissue ? seal(fallback) : null,
  ]);
  const resource = `${proof.id}.${sendProof}.`;
  const prefix = otpPrefix(now, proof.id, proof.source, proof);
  const effects = reissue ? {
    sql: `${prefix.sql}${sendGate}
      INSERT INTO effect_outbox (id, kind, dedupe_key, resource_ref, due_at, state, expires_at)
      SELECT ?, ?, ?, CASE WHEN a.code_mac IN (?, ?) THEN ? ELSE ? END, ${nowSql}, 'pending', ${nowSql} + ${lifetime}
      FROM challenge a WHERE a.state IN ('pending', 'expired') AND a.generation = ? AND (SELECT at FROM send_gate) = ${nowSql}
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    params: [...prefix.params ?? [], effectId, otpEmailEffectKind, dedupeKey, pendingCode, previousTransportMac,
      resource + fallbackEncrypted, resource + encrypted, reissue.revision],
  } : {
    sql: `${prefix.sql}${sendGate}
      INSERT INTO effect_outbox (id, kind, dedupe_key, resource_ref, due_at, state, expires_at)
      SELECT ?, ?, ?, ?, ${nowSql}, 'pending', ${nowSql} + ${lifetime}
      WHERE NOT EXISTS (SELECT 1 FROM otp_attempts WHERE id = ?) AND (SELECT at FROM send_gate) = ${nowSql}
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    params: [...prefix.params ?? [], effectId, otpEmailEffectKind, dedupeKey, resource + encrypted, proof.id],
  };
  const mark = reissue ? {
    sql: `UPDATE otp_attempts SET state = 'pending', issued_at = ?, expires_at = ?, generation = ?,
      code_mac = CASE WHEN code_mac IN (?, ?) THEN ? ELSE ? END
      WHERE id = ? AND EXISTS (SELECT 1 FROM effect_outbox WHERE id = ?)`,
    params: [now, now + lifetime, next, pendingCode, previousTransportMac, fallbackCode, pendingCode, proof.id, effectId],
  } : {
    sql: `INSERT INTO otp_attempts (id, email_key, device_key, issued_at, expires_at, code_mac, state)
      SELECT ?, ?, ?, ?, ?, ?, 'pending' WHERE EXISTS (SELECT 1 FROM effect_outbox WHERE id = ?)`,
    params: [proof.id, proof.email, proof.device, now, now + lifetime, pendingCode, effectId],
  };
  const invalidate: CommandStatement[] = reissue ? [] : [{
    sql: `UPDATE otp_attempts SET state = 'invalidated' WHERE email_key = ? AND device_key = ? AND id <> ?
      AND state IN ('pending', 'expired') AND EXISTS (SELECT 1 FROM effect_outbox WHERE id = ?)`,
    params: [proof.email, proof.device, proof.id, effectId],
  }];
  const sent = {
    sql: `${prefix.sql}
      INSERT INTO otp_events (id, bucket_kind, bucket_key, kind, at)
      SELECT ? || ':' || kind, kind, key, 'sent', ${nowSql} FROM buckets WHERE EXISTS (SELECT 1 FROM effect_outbox WHERE id = ?)`,
    params: [...prefix.params ?? [], effectId, effectId],
  };
  return commitCommand(ctx, prepareCommand<SendResult>(ctx, {
    statements: [effects, mark, ...invalidate, sent, selectAttempt(prefix)],
    decode(results) {
      const row = results.at(-1)?.results[0] as AttemptRow;
      if (!row.id) {
        if (reissue) return { kind: "missing" };
        return row.resend_at > now ? { kind: "locked", retryAt: row.resend_at } : { kind: "stale" };
      }
      if (results[0]?.results.length) return { kind: "ok", attempt: projectAttempt(row, token, now), workKey: effectId };
      if (!reissue || (row.generation === next && row.send_proof === sendProof)) return { kind: "ok", attempt: projectAttempt(row, token, now) };
      if (row.lock_until !== null) return { kind: "locked", retryAt: row.lock_until };
      if (row.generation !== reissue.revision || row.state === "consumed" || row.state === "invalidated") return { kind: "stale" };
      return row.resend_at > now ? { kind: "locked", retryAt: row.resend_at } : { kind: "stale" };
    },
  }));
}

export async function verifyOtp(ctx: RequestScope, key: CryptoKey, token: string, input: Verify, source: string | null): Promise<VerifyResult> {
  const { payload, operationId } = input;
  const now = ctx.now;
  const proof = await proofFor(key, token, payload, source);
  const [code, emailKey] = await Promise.all([
    mac(key, "otp-code", proof.id, proof.email, payload.transport, payload.code),
    mailboxKey(key, payload.email),
  ]);
  const verified = await mac(key, "otp-verify", proof.id, proof.email, proof.device, payload.transport, operationId, code);
  const [sessionId, credential] = await Promise.all([mac(key, "otp-session-id", verified), mac(key, "otp-session-secret", verified)]);
  const secretHash = await hashSessionCredential(credential);
  const claimed = `${verified}.${crypto.randomUUID()}`;
  const accountId = crypto.randomUUID();
  const prefix = otpPrefix(now, proof.id, proof.source, proof);
  const pending = `a.state = 'pending' AND a.expires_at > ${nowSql} AND (SELECT until FROM active_lock) IS NULL`;
  const consumed = "EXISTS (SELECT 1 FROM otp_attempts WHERE id = ? AND verified_request_id = ?)";
  const scope = {
    sql: `WITH acting_session AS MATERIALIZED (
      SELECT s.id AS session_id, s.account_id, s.active_context_id AS context_id, s.expires_at
      FROM otp_attempts o JOIN sessions s ON s.id = ? AND s.secret_hash = ? JOIN accounts a ON a.id = s.account_id
      WHERE o.id = ? AND substr(o.verified_request_id, 1, 43) = ? AND a.state = 'active'
        AND s.revoked_at IS NULL AND s.expires_at > ? AND s.issued_at > ? AND s.issued_at <= ?
    )`,
    params: [sessionId, secretHash, proof.id, verified, now, now - verifyReplayMs, now],
  };
  return commitCommand(ctx, prepareCommand<VerifyResult>(ctx, {
    statements: [
      {
        sql: `${prefix.sql}
          INSERT INTO otp_events (id, bucket_kind, bucket_key, kind, at)
          SELECT ? || ':' || b.kind, b.kind, b.key, 'verify_failed', ${nowSql} FROM buckets b
          WHERE EXISTS (SELECT 1 FROM challenge a WHERE ${pending} AND a.code_mac <> ?)
          ON CONFLICT(id) DO NOTHING`,
        params: [...prefix.params ?? [], verified, code],
      },
      {
        sql: `${prefix.sql}
          INSERT INTO otp_lockouts (bucket_kind, bucket_key, until)
          SELECT b.kind, b.key, ${nowSql} + ${lockoutMs} FROM buckets b WHERE changes() > 0
            AND EXISTS (SELECT 1 FROM otp_events e WHERE e.id = ? || ':' || b.kind)
            AND (SELECT count(*) FROM otp_events e WHERE e.bucket_kind = b.kind AND e.bucket_key = b.key
              AND e.kind = 'verify_failed' AND e.at > ${nowSql} - ${windowMs}) >= b.checks
          ON CONFLICT (bucket_kind, bucket_key) DO UPDATE SET until = excluded.until WHERE otp_lockouts.until <= ${nowSql}`,
        params: [...prefix.params ?? [], verified],
      },
      {
        sql: `${prefix.sql}
          UPDATE otp_attempts SET state = 'consumed', verified_request_id = ? WHERE EXISTS (
            SELECT 1 FROM challenge a WHERE a.id = otp_attempts.id AND ${pending} AND a.code_mac = ?
          ) RETURNING id`,
        params: [...prefix.params ?? [], claimed, code],
      },
      {
        sql: `INSERT INTO accounts (id, email_normalized, email_key, verified_at, state)
          SELECT ?, ?, ?, ?, 'active' WHERE ${consumed}
          ON CONFLICT(email_normalized) DO UPDATE SET email_key = excluded.email_key
          WHERE accounts.state = 'active' AND accounts.email_key IS NOT excluded.email_key`,
        params: [accountId, payload.email, emailKey, now, proof.id, claimed],
      },
      {
        sql: `INSERT INTO account_preferences (account_id) SELECT id FROM accounts WHERE email_normalized = ? AND state = 'active'
          AND ${consumed} ON CONFLICT(account_id) DO NOTHING`,
        params: [payload.email, proof.id, claimed],
      },
      {
        sql: `INSERT INTO account_contexts (id, account_id, role)
          SELECT ?, id, 'customer' FROM accounts WHERE id = ? AND ${consumed}`,
        params: [crypto.randomUUID(), accountId, proof.id, claimed],
      },
      {
        sql: `INSERT INTO sessions (id, account_id, secret_hash, active_context_id, device_id, issued_at, expires_at)
          SELECT ?, a.id, ?, ${defaultContextSql}, ?, ?, ? FROM accounts a
          WHERE a.email_normalized = ? AND a.state = 'active' AND ${consumed}`,
        params: [sessionId, secretHash, proof.device, now, now + sessionLifetime, payload.email, proof.id, claimed],
      },
      sessionProjection(scope),
      {
        sql: `${prefix.sql} SELECT a.state, a.expires_at, (SELECT until FROM active_lock) AS lock_until, ${wrongCount} AS wrong
          FROM challenge a WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = ? AND s.revoked_at IS NULL AND s.issued_at > ?)`,
        params: [...prefix.params ?? [], sessionId, now - verifyReplayMs],
      },
    ],
    decode(results) {
      const session = decodeSession(results.at(-2));
      if (session) return { kind: "verified", session, credential };
      const row = results.at(-1)?.results[0] as Pick<AttemptRow, "state" | "expires_at" | "lock_until" | "wrong"> | undefined;
      if (!row) return { kind: "missing" };
      if (results[2]?.results.length) return { kind: "denied" };
      if (row.state === "consumed") return { kind: "consumed" };
      if (row.state === "invalidated") return { kind: "missing" };
      if (row.lock_until !== null) return { kind: "locked", retryAt: row.lock_until };
      if (row.expires_at <= now || row.state === "expired") return { kind: "expired" };
      return { kind: "wrong_code", triesLeft: Math.max(1, 5 - row.wrong) };
    },
  }));
}

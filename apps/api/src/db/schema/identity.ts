import { ACCOUNT_STATES, OTP_ATTEMPT_STATES, THEMES } from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accountContexts } from "./access";

const otpBucketKinds = ["email", "device", "source"] as const;
const otpEventKinds = ["sent", "verify_failed"] as const;

export const accounts = sqliteTable("accounts", {
  id: text().notNull().primaryKey(),
  emailNormalized: text("email_normalized").notNull().unique(),
  emailKey: text("email_key").unique(),
  displayName: text("display_name"),
  verifiedAt: integer("verified_at").notNull(),
  setupAt: integer("setup_at"),
  state: text({ enum: ACCOUNT_STATES }).notNull(),
}, (t) => [
  check("accounts_state", sql`${t.state} IN ('active', 'restricted', 'closed')`),
  check("accounts_setup", sql`${t.setupAt} IS NULL OR (${t.setupAt} >= ${t.verifiedAt} AND ${t.displayName} IS NOT NULL)`),
]);

export const accountPreferences = sqliteTable("account_preferences", {
  accountId: text("account_id").notNull().primaryKey().references(() => accounts.id),
  uiLocale: text("ui_locale"),
  readingLocale: text("reading_locale"),
  displayZone: text("display_zone"),
  theme: text({ enum: THEMES }).notNull().default("system"),
  fieldMode: integer("field_mode", { mode: "boolean" }),
  twoClock: integer("two_clock", { mode: "boolean" }).notNull().default(false),
  shareDisplayZone: integer("share_display_zone", { mode: "boolean" }).notNull().default(false),
  revision: integer().notNull().default(0),
}, (t) => [
  check("account_preferences_theme", sql`${t.theme} IN ('system', 'light', 'dark')`),
  check("account_preferences_field_mode", sql`${t.fieldMode} IS NULL OR ${t.fieldMode} IN (0, 1)`),
  check("account_preferences_two_clock", sql`${t.twoClock} IN (0, 1)`),
  check("account_preferences_share_display_zone", sql`${t.shareDisplayZone} IN (0, 1)`),
  check("account_preferences_revision", sql`${t.revision} >= 0`),
]);

export const sessions = sqliteTable("sessions", {
  id: text().notNull().primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  secretHash: text("secret_hash").notNull().unique(),
  revocationHash: text("revocation_hash"),
  activeContextId: text("active_context_id"),
  deviceId: text("device_id").notNull(),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [
  check("sessions_term", sql`typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} > ${t.issuedAt}
    AND (${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.issuedAt})`),
  foreignKey({ columns: [t.activeContextId, t.accountId], foreignColumns: [accountContexts.id, accountContexts.accountId] }),
  unique().on(t.id, t.accountId, t.deviceId),
  index("sessions_account_active").on(t.accountId, t.expiresAt, t.id).where(sql`${t.revokedAt} IS NULL`),
  index("sessions_active_context").on(t.activeContextId, t.accountId).where(sql`${t.activeContextId} IS NOT NULL`),
]);

export const otpAttempts = sqliteTable("otp_attempts", {
  id: text().notNull().primaryKey(),
  emailKey: text("email_key").notNull(),
  deviceKey: text("device_key").notNull(),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  codeMac: text("code_mac").notNull(),
  generation: integer().notNull().default(1),
  state: text({ enum: OTP_ATTEMPT_STATES }).notNull(),
  verifiedRequestId: text("verified_request_id"),
}, (t) => [
  check("otp_attempts_state", sql`${t.state} IN ('pending', 'consumed', 'invalidated', 'expired')`),
  check("otp_attempts_lifetime", sql`typeof(${t.expiresAt}) = 'integer' AND ${t.expiresAt} = ${t.issuedAt} + 600000`),
  check("otp_attempts_generation", sql`${t.generation} > 0`),
  check("otp_attempts_consumed", sql`(${t.state} = 'consumed') = (${t.verifiedRequestId} IS NOT NULL)`),
  index("otp_attempts_email_state").on(t.emailKey, t.state, t.issuedAt, t.id),
  index("otp_attempts_pending_due").on(t.expiresAt, t.id).where(sql`${t.state} = 'pending'`),
]);

export const otpEvents = sqliteTable("otp_events", {
  id: text().notNull().primaryKey(),
  bucketKind: text("bucket_kind", { enum: otpBucketKinds }).notNull(),
  bucketKey: text("bucket_key").notNull(),
  kind: text({ enum: otpEventKinds }).notNull(),
  at: integer().notNull(),
}, (t) => [
  check("otp_events_bucket", sql`${t.bucketKind} IN ('email', 'device', 'source')`),
  check("otp_events_kind", sql`${t.kind} IN ('sent', 'verify_failed')`),
  index("otp_events_bucket_time").on(t.bucketKind, t.bucketKey, t.kind, t.at, t.id),
  index("otp_events_time").on(t.at, t.id),
]);

export const otpLockouts = sqliteTable("otp_lockouts", {
  bucketKind: text("bucket_kind", { enum: otpBucketKinds }).notNull(),
  bucketKey: text("bucket_key").notNull(),
  until: integer().notNull(),
}, (t) => [
  primaryKey({ columns: [t.bucketKind, t.bucketKey] }),
  check("otp_lockouts_bucket", sql`${t.bucketKind} IN ('email', 'device', 'source')`),
  check("otp_lockouts_until", sql`typeof(${t.until}) = 'integer'`),
  index("otp_lockouts_due").on(t.until, t.bucketKind, t.bucketKey),
]);

export const accountSecurityEvents = sqliteTable("account_security_events", {
  id: text().notNull().primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  actorId: text("actor_id").references(() => accounts.id),
  kind: text().notNull(),
  at: integer().notNull(),
  safeReason: text("safe_reason"),
}, (t) => [
  check("account_security_events_reason", sql`${t.safeReason} IS NULL OR (length(${t.safeReason}) BETWEEN 1 AND 64 AND ${t.safeReason} NOT GLOB '*[^a-z0-9_]*')`),
  index("account_security_events_account_time").on(t.accountId, t.at, t.id),
]);

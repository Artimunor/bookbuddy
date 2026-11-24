import { EFFECT_STATES, PUSH_INSTALLATION_STATES, PUSH_PLATFORMS, PUSH_TICKET_STATES, SYNC_CHANGE_OPERATIONS } from "@bookbuddy/domain";
import { sql } from "drizzle-orm";
import { blob, check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accountContexts } from "./access";
import { accounts } from "./identity";

export const operationReceipts = sqliteTable("operation_receipts", {
  accountId: text("account_id").notNull().references(() => accounts.id),
  contextId: text("context_id").notNull(),
  operationId: text("operation_id").notNull(),
  inputHash: text("input_hash").notNull(),
  command: text("command").notNull(),
  resultRef: text("result_ref").notNull(),
  committedAt: integer("committed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.accountId, t.contextId, t.operationId] }),
  foreignKey({ columns: [t.contextId, t.accountId], foreignColumns: [accountContexts.id, accountContexts.accountId] }),
  index("operation_receipts_context").on(t.contextId),
  index("operation_receipts_committed").on(t.committedAt),
  uniqueIndex("operation_receipts_pending").on(t.resultRef).where(sql`${t.resultRef} GLOB 'pending:*'`),
]);

export const syncScopeState = sqliteTable("sync_scope_state", {
  contextId: text("context_id").notNull().primaryKey().references(() => accountContexts.id),
  visibilityEpoch: integer("visibility_epoch").notNull().default(0),
}, (t) => [check("sync_scope_state_epoch", sql`${t.visibilityEpoch} >= 0`)]);

export const syncChanges = sqliteTable("sync_changes", {
  seq: integer().primaryKey({ autoIncrement: true }),
  kind: text().notNull(),
  resourceId: text("resource_id").notNull(),
  partitionKey: text("partition_key").notNull(),
  op: text({ enum: SYNC_CHANGE_OPERATIONS }).notNull(),
  at: integer().notNull(),
}, (t) => [
  check("sync_changes_op", sql`${t.op} IN ('upsert', 'remove')`),
  index("sync_changes_partition_seq").on(t.partitionKey, t.seq),
]);

export const syncRetention = sqliteTable("sync_retention", {
  id: integer().notNull().primaryKey(),
  floorSeq: integer("floor_seq").notNull(),
}, (t) => [check("sync_retention_singleton", sql`${t.id} = 1`), check("sync_retention_floor", sql`${t.floorSeq} >= 0`)]);

export const linkTargets = sqliteTable("link_targets", {
  token: text().notNull().primaryKey(),
  kind: text().notNull(),
  resourceId: text("resource_id").notNull(),
  requiredScope: text("required_scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("link_targets_resource").on(t.kind, t.resourceId, t.requiredScope, t.expiresAt)]);

export const notifications = sqliteTable("notifications", {
  id: text().notNull().primaryKey(),
  contextId: text("context_id").notNull().references(() => accountContexts.id),
  eventKey: text("event_key").notNull(),
  kind: text().notNull(),
  linkToken: text("link_token").references(() => linkTargets.token),
  createdAt: integer("created_at").notNull(),
  readAt: integer("read_at"),
}, (t) => [
  unique().on(t.contextId, t.eventKey),
  index("notifications_context_created").on(t.contextId, t.createdAt, t.id),
  index("notifications_context_id").on(t.contextId, t.id),
  index("notifications_link_token").on(t.linkToken),
]);

export const pushInstallations = sqliteTable("push_installations", {
  id: text().notNull().primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  token: text().notNull(),
  tokenEpoch: integer("token_epoch").notNull(),
  platform: text({ enum: PUSH_PLATFORMS }).notNull(),
  state: text({ enum: PUSH_INSTALLATION_STATES }).notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  check("push_installations_epoch", sql`${t.tokenEpoch} > 0`),
  check("push_installations_platform", sql`${t.platform} IN ('ios', 'android')`),
  check("push_installations_state", sql`${t.state} IN ('active', 'disabled', 'revoked')`),
  uniqueIndex("push_installations_active_token").on(t.token).where(sql`${t.state} = 'active'`),
  index("push_installations_account_active").on(t.accountId, t.state, t.id),
]);

export const effectOutbox = sqliteTable("effect_outbox", {
  id: text().notNull().primaryKey(),
  kind: text().notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  resourceRef: text("resource_ref").notNull(),
  dueAt: integer("due_at").notNull(),
  state: text({ enum: EFFECT_STATES }).notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [
  check("effect_outbox_state", sql`${t.state} IN ('pending', 'claimed', 'delivered', 'failed', 'unknown', 'skipped')`),
  index("effect_outbox_due").on(t.state, t.dueAt, t.id),
]);

export const effectClaims = sqliteTable("effect_claims", {
  effectId: text("effect_id").notNull().references(() => effectOutbox.id),
  attempt: integer().notNull(),
  claimId: text("claim_id").notNull(),
  fence: integer().notNull(),
  claimedAt: integer("claimed_at").notNull(),
  leaseUntil: integer("lease_until").notNull(),
  resultCode: text("result_code"),
  providerRef: text("provider_ref"),
}, (t) => [
  primaryKey({ columns: [t.effectId, t.attempt] }),
  index("effect_claims_claim").on(t.claimId, t.effectId),
]);

export const pushTickets = sqliteTable("push_tickets", {
  id: text().notNull().primaryKey(),
  effectId: text("effect_id").notNull().references(() => effectOutbox.id),
  installationId: text("installation_id").notNull().references(() => pushInstallations.id),
  tokenEpoch: integer("token_epoch").notNull(),
  nextCheckAt: integer("next_check_at").notNull(),
  state: text({ enum: PUSH_TICKET_STATES }).notNull(),
}, (t) => [
  check("push_tickets_state", sql`${t.state} IN ('due', 'delivered', 'rejected', 'unknown')`),
  index("push_tickets_due").on(t.state, t.nextCheckAt, t.id),
  index("push_tickets_effect").on(t.effectId),
  index("push_tickets_installation").on(t.installationId, t.tokenEpoch),
]);

export const providerCredentials = sqliteTable("provider_credentials", {
  provider: text().notNull().primaryKey(),
  ciphertext: blob({ mode: "buffer" }).notNull(),
  expiresAt: integer("expires_at").notNull(),
  refreshLeaseUntil: integer("refresh_lease_until"),
});

export const featureFlags = sqliteTable("feature_flags", {
  key: text().notNull(),
  scopeKey: text("scope_key").notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  configVersion: integer("config_version").notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.scopeKey] }), check("feature_flags_enabled", sql`${t.enabled} IN (0, 1)`)]);

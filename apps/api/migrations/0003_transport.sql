CREATE TABLE operation_receipts (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  context_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  command TEXT NOT NULL,
  result_ref TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  FOREIGN KEY (context_id, account_id) REFERENCES account_contexts(id, account_id),
  PRIMARY KEY (account_id, context_id, operation_id)
);
CREATE INDEX operation_receipts_context ON operation_receipts(context_id);
CREATE INDEX operation_receipts_committed ON operation_receipts(committed_at);
CREATE UNIQUE INDEX operation_receipts_pending ON operation_receipts(result_ref)
  WHERE result_ref GLOB 'pending:*';

CREATE TABLE sync_scope_state (
  context_id TEXT NOT NULL PRIMARY KEY REFERENCES account_contexts(id),
  visibility_epoch INTEGER NOT NULL DEFAULT 0 CHECK (visibility_epoch >= 0)
);

CREATE TABLE sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'remove')),
  at INTEGER NOT NULL
);
CREATE INDEX sync_changes_partition_seq ON sync_changes(partition_key, seq);

CREATE TABLE sync_retention (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  floor_seq INTEGER NOT NULL CHECK (floor_seq >= 0)
);
INSERT INTO sync_retention (id, floor_seq) VALUES (1, 0);

CREATE TABLE link_targets (
  token TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  required_scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX link_targets_resource ON link_targets(kind, resource_id, required_scope, expires_at);
CREATE INDEX link_targets_scope_expiry ON link_targets(required_scope, expires_at, token);

CREATE TABLE notifications (
  id TEXT NOT NULL PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES account_contexts(id),
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  link_token TEXT REFERENCES link_targets(token),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (event_key, context_id)
);
CREATE INDEX notifications_context_created ON notifications(context_id, created_at, id);
CREATE INDEX notifications_context_id ON notifications(context_id, id);
CREATE INDEX notifications_link_token ON notifications(link_token);

CREATE TABLE push_installations (
  id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT,
  token TEXT NOT NULL,
  token_epoch INTEGER NOT NULL CHECK (token_epoch > 0),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  state TEXT NOT NULL CHECK (state IN ('active', 'disabled', 'revoked')),
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX push_installations_active_token ON push_installations(token) WHERE state = 'active';
CREATE INDEX push_installations_account_active ON push_installations(account_id, state, id);
CREATE INDEX push_installations_device_revocable ON push_installations(account_id, device_id) WHERE state <> 'revoked';

CREATE TABLE effect_outbox (
  id TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  resource_ref TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'delivered', 'failed', 'unknown', 'skipped')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX effect_outbox_due ON effect_outbox(state, due_at, id);

CREATE TABLE effect_claims (
  effect_id TEXT NOT NULL REFERENCES effect_outbox(id),
  attempt INTEGER NOT NULL,
  claim_id TEXT NOT NULL,
  fence INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  result_code TEXT,
  provider_ref TEXT,
  PRIMARY KEY (effect_id, attempt)
);
CREATE INDEX effect_claims_claim ON effect_claims(claim_id, effect_id);

CREATE TABLE push_tickets (
  id TEXT NOT NULL PRIMARY KEY,
  effect_id TEXT NOT NULL REFERENCES effect_outbox(id),
  installation_id TEXT NOT NULL REFERENCES push_installations(id),
  token_epoch INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('due', 'delivered', 'rejected', 'unknown'))
);
CREATE INDEX push_tickets_due ON push_tickets(state, next_check_at, id);
CREATE INDEX push_tickets_effect ON push_tickets(effect_id);
CREATE INDEX push_tickets_installation ON push_tickets(installation_id, token_epoch);

CREATE TABLE provider_credentials (
  provider TEXT NOT NULL PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_lease_until INTEGER
);

CREATE TABLE feature_flags (
  key TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  config_version INTEGER NOT NULL,
  PRIMARY KEY (key, scope_key)
);

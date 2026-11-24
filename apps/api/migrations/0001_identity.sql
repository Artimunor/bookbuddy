CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  -- Imported accounts receive the mailbox key on their next successful verification.
  email_key TEXT UNIQUE,
  display_name TEXT,
  verified_at INTEGER NOT NULL,
  setup_at INTEGER,
  state TEXT NOT NULL,
  CONSTRAINT accounts_state CHECK (state IN ('active', 'restricted', 'closed')),
  CONSTRAINT accounts_setup CHECK (setup_at IS NULL OR (setup_at >= verified_at AND display_name IS NOT NULL))
);

CREATE TABLE account_preferences (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts (id),
  ui_locale TEXT,
  reading_locale TEXT,
  display_zone TEXT,
  theme TEXT NOT NULL DEFAULT 'system',
  field_mode INTEGER,
  two_clock INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT account_preferences_theme CHECK (theme IN ('system', 'light', 'dark')),
  CONSTRAINT account_preferences_field_mode CHECK (field_mode IS NULL OR field_mode IN (0, 1)),
  CONSTRAINT account_preferences_two_clock CHECK (two_clock IN (0, 1)),
  CONSTRAINT account_preferences_revision CHECK (revision >= 0)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  secret_hash TEXT NOT NULL UNIQUE,
  active_context_id TEXT,
  device_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CONSTRAINT sessions_term CHECK (expires_at > issued_at AND (revoked_at IS NULL OR revoked_at >= issued_at)),
  FOREIGN KEY (active_context_id, account_id) REFERENCES account_contexts (id, account_id)
);
CREATE INDEX sessions_account_active ON sessions (account_id, expires_at, id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_active_context ON sessions (active_context_id, account_id) WHERE active_context_id IS NOT NULL;

-- The attempt is possession-bound; the database retains no plaintext OTP or challenge mailbox.
CREATE TABLE otp_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  email_key TEXT NOT NULL,
  device_key TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  code_mac TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  verified_request_id TEXT,
  CONSTRAINT otp_attempts_state CHECK (state IN ('pending', 'consumed', 'invalidated', 'expired')),
  CONSTRAINT otp_attempts_lifetime CHECK (expires_at = issued_at + 600000),
  CONSTRAINT otp_attempts_generation CHECK (generation > 0),
  CONSTRAINT otp_attempts_consumed CHECK ((state = 'consumed') = (verified_request_id IS NOT NULL))
);
CREATE INDEX otp_attempts_email_state ON otp_attempts (email_key, state, issued_at, id);
CREATE INDEX otp_attempts_pending_due ON otp_attempts (expires_at, id) WHERE state = 'pending';

CREATE TABLE otp_events (
  id TEXT PRIMARY KEY NOT NULL,
  bucket_kind TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  CONSTRAINT otp_events_bucket CHECK (bucket_kind IN ('email', 'device', 'source')),
  CONSTRAINT otp_events_kind CHECK (kind IN ('sent', 'verify_failed'))
);
CREATE INDEX otp_events_bucket_time ON otp_events (bucket_kind, bucket_key, kind, at, id);
CREATE INDEX otp_events_time ON otp_events (at, id);

CREATE TABLE otp_lockouts (
  bucket_kind TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (bucket_kind, bucket_key),
  CONSTRAINT otp_lockouts_bucket CHECK (bucket_kind IN ('email', 'device', 'source'))
);
CREATE INDEX otp_lockouts_due ON otp_lockouts (until, bucket_kind, bucket_key);

CREATE TABLE account_security_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  actor_id TEXT REFERENCES accounts (id),
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  safe_reason TEXT,
  CONSTRAINT account_security_events_reason CHECK (
    safe_reason IS NULL OR (length(safe_reason) BETWEEN 1 AND 64 AND safe_reason NOT GLOB '*[^a-z0-9_]*')
  )
);
CREATE INDEX account_security_events_account_time ON account_security_events (account_id, at, id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  place_id TEXT NOT NULL REFERENCES places (id),
  requester_id TEXT NOT NULL REFERENCES accounts (id),
  request_operation_id TEXT,
  accountable_foreman_membership_id TEXT,
  trade TEXT,
  origin TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT jobs_reference CHECK (reference GLOB 'BB-[A-Z0-9]*' AND substr(reference, 4) NOT GLOB '*[^A-Z0-9]*'),
  CONSTRAINT jobs_origin CHECK (origin IN ('bookbuddy', 'provider')),
  CONSTRAINT jobs_state CHECK (state IN ('open', 'cancelled', 'closed')),
  CONSTRAINT jobs_revision CHECK (typeof(revision) = 'integer' AND revision >= 0),
  UNIQUE (id, business_id),
  UNIQUE (id, place_id),
  FOREIGN KEY (business_id, accountable_foreman_membership_id) REFERENCES memberships (business_id, id),
  FOREIGN KEY (place_id, requester_id) REFERENCES place_people (place_id, account_id)
);
CREATE INDEX jobs_business_state ON jobs (business_id, state, id);
CREATE INDEX jobs_place_state ON jobs (place_id, state, id);
CREATE INDEX jobs_foreman_state ON jobs (accountable_foreman_membership_id, state, id);
CREATE UNIQUE INDEX jobs_request_operation ON jobs (requester_id, request_operation_id) WHERE request_operation_id IS NOT NULL;

CREATE TABLE requests (
  job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs (id),
  original_text TEXT,
  original_language TEXT,
  arrival_arrangement TEXT NOT NULL,
  arrival_contact_name TEXT,
  safe_note TEXT,
  submitted_at INTEGER NOT NULL,
  CONSTRAINT requests_text CHECK (original_text IS NULL OR length(trim(original_text, char(9, 10, 11, 12, 13, 32))) > 0),
  CONSTRAINT requests_arrival CHECK (
    arrival_arrangement IN ('nobody', 'requester', 'someone_else', 'to_be_arranged')
    AND (arrival_arrangement = 'someone_else') = (arrival_contact_name IS NOT NULL)
    AND (arrival_contact_name IS NULL OR length(trim(arrival_contact_name, char(9, 10, 11, 12, 13, 32))) > 0)
    AND (arrival_arrangement <> 'nobody' OR safe_note IS NOT NULL)
    AND (safe_note IS NULL OR length(trim(safe_note, char(9, 10, 11, 12, 13, 32))) > 0)
  ),
  CONSTRAINT requests_submitted_at CHECK (typeof(submitted_at) = 'integer')
);
-- The submission command must check the live request grant and verified in-area
-- place, and atomically validate/link every retained ready attachment in 0011.
-- A NULL original_text requires a ready, scoped original voice attachment;
-- photos and transcripts cannot substitute for it.

CREATE TABLE job_handoffs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  incumbent_id TEXT,
  recipient_id TEXT NOT NULL,
  issuer_id TEXT REFERENCES accounts (id),
  reoffer_of_id TEXT,
  policy TEXT NOT NULL,
  call_confirmed_at INTEGER,
  offered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  decline_reason TEXT,
  state TEXT NOT NULL,
  reofferable_id TEXT GENERATED ALWAYS AS (
    CASE WHEN reoffer_of_id IS NULL AND state IN ('declined', 'expired') THEN id END
  ) VIRTUAL,
  CONSTRAINT job_handoffs_state CHECK (state IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  CONSTRAINT job_handoffs_distinct CHECK (incumbent_id IS NULL OR incumbent_id <> recipient_id),
  CONSTRAINT job_handoffs_policy CHECK (
    (policy = 'standard' AND call_confirmed_at IS NULL)
    OR (policy = 'urgent' AND typeof(call_confirmed_at) = 'integer' AND call_confirmed_at <= offered_at)
  ),
  CONSTRAINT job_handoffs_issuer CHECK (
    issuer_id IS NOT NULL OR (policy = 'standard' AND incumbent_id IS NULL AND reoffer_of_id IS NULL)
  ),
  CONSTRAINT job_handoffs_resolution CHECK (
    typeof(offered_at) = 'integer' AND typeof(expires_at) = 'integer' AND expires_at > offered_at
    AND (state = 'offered') = (ended_at IS NULL)
    AND (ended_at IS NULL OR (typeof(ended_at) = 'integer' AND ended_at >= offered_at))
    AND (state NOT IN ('accepted', 'declined') OR ended_at < expires_at)
    AND (state <> 'expired' OR ended_at >= expires_at)
    AND (decline_reason IS NULL OR (state = 'declined' AND length(trim(decline_reason, char(9, 10, 11, 12, 13, 32))) > 0))
  ),
  UNIQUE (job_id, reofferable_id),
  FOREIGN KEY (job_id, business_id) REFERENCES jobs (id, business_id),
  FOREIGN KEY (business_id, incumbent_id) REFERENCES memberships (business_id, id),
  FOREIGN KEY (business_id, recipient_id) REFERENCES memberships (business_id, id),
  FOREIGN KEY (job_id, reoffer_of_id) REFERENCES job_handoffs (job_id, reofferable_id)
);
CREATE UNIQUE INDEX job_handoffs_one_offered ON job_handoffs (job_id) WHERE state = 'offered';
CREATE UNIQUE INDEX job_handoffs_one_reoffer ON job_handoffs (reoffer_of_id) WHERE reoffer_of_id IS NOT NULL;
CREATE INDEX job_handoffs_job_history ON job_handoffs (job_id, offered_at, id);
CREATE INDEX job_handoffs_recipient_due ON job_handoffs (recipient_id, state, expires_at, id);
CREATE INDEX job_handoffs_due ON job_handoffs (expires_at, id) WHERE state = 'offered';
-- Issuance computes two staffed hours (or 30 staffed minutes with a call).
-- Reoffer only a declined/expired original to an authorised alternate. Live
-- acceptance checks the exact pending offer, deadline, incumbent and authority
-- before changing the foreman; expiry/decline/withdrawal never assigns anyone.

CREATE TABLE job_grants (
  job_id TEXT NOT NULL REFERENCES jobs (id),
  context_id TEXT NOT NULL REFERENCES account_contexts (id),
  capability TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (job_id, context_id, capability, valid_from),
  CONSTRAINT job_grants_capability CHECK (capability IN ('intake', 'reviewer', 'backup', 'rectification')),
  CONSTRAINT job_grants_term CHECK (
    typeof(valid_from) = 'integer' AND typeof(valid_until) = 'integer' AND valid_until > valid_from
    AND (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= valid_from))
  )
);
-- A grant is bounded history, not a substitute for the current context, its
-- business membership and the relevant job relationship. Revoke before regrant.
CREATE UNIQUE INDEX job_grants_current ON job_grants (job_id, context_id, capability) WHERE revoked_at IS NULL;
CREATE INDEX job_grants_context ON job_grants (context_id, job_id, capability);
CREATE INDEX job_grants_due ON job_grants (valid_until, job_id, context_id, capability) WHERE revoked_at IS NULL;

CREATE TABLE support_cases (
  id TEXT PRIMARY KEY NOT NULL,
  reporter_id TEXT REFERENCES accounts (id),
  operation_id TEXT,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  message TEXT NOT NULL,
  reported_reference TEXT,
  reply_email_ciphertext TEXT,
  received_at INTEGER NOT NULL,
  CONSTRAINT support_cases_kind CHECK (kind IN ('sign_in', 'access', 'eligibility', 'property', 'other')),
  CONSTRAINT support_cases_state CHECK (state IN ('open', 'responded', 'closed')),
  CONSTRAINT support_cases_message CHECK (length(trim(message, char(9, 10, 11, 12, 13, 32))) BETWEEN 1 AND 2000),
  CONSTRAINT support_cases_received_at CHECK (typeof(received_at) = 'integer')
);
-- An unauthenticated intake has no reporter account. A reported reference is
-- an opaque hint for support, never a job link, lookup credential or authority.
CREATE INDEX support_cases_reporter ON support_cases (reporter_id, received_at, id) WHERE reporter_id IS NOT NULL;
CREATE INDEX support_cases_state_received ON support_cases (state, received_at, id);
CREATE UNIQUE INDEX support_cases_operation ON support_cases (reporter_id, operation_id) WHERE operation_id IS NOT NULL;

-- Signed-out support has no account/context. Keep a separate, HMAC-scoped
-- receipt so retries and throttling do not persist the caller's address.
CREATE TABLE anonymous_support_receipts (
  source_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  case_id TEXT NOT NULL UNIQUE REFERENCES support_cases (id),
  committed_at INTEGER NOT NULL CONSTRAINT anonymous_support_receipts_committed_at CHECK (typeof(committed_at) = 'integer'),
  PRIMARY KEY (source_key, operation_id)
);
CREATE INDEX anonymous_support_receipts_source_time ON anonymous_support_receipts (source_key, committed_at);

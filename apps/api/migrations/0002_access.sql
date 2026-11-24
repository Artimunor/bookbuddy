CREATE TABLE operating_areas (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  site_zone TEXT NOT NULL,
  polygon TEXT NOT NULL,
  UNIQUE (id, site_zone),
  CONSTRAINT operating_areas_polygon CHECK (
    CASE WHEN json_valid(polygon) THEN json_type(polygon) = 'array' AND json_array_length(polygon) > 0 ELSE 0 END
  )
);

CREATE TABLE staffed_calendar (
  id TEXT PRIMARY KEY NOT NULL,
  area_id TEXT NOT NULL REFERENCES operating_areas (id),
  weekday INTEGER,
  local_date TEXT,
  opens_minute INTEGER,
  closes_minute INTEGER,
  CONSTRAINT staffed_calendar_day CHECK (
    (weekday IS NULL) <> (local_date IS NULL)
    AND (weekday IS NULL OR (typeof(weekday) = 'integer' AND weekday BETWEEN 1 AND 7))
    AND (local_date IS NULL OR date(local_date, '+0 days') IS local_date)
  ),
  CONSTRAINT staffed_calendar_hours CHECK (
    (weekday IS NULL AND opens_minute IS NULL AND closes_minute IS NULL)
    OR (typeof(opens_minute) = 'integer' AND typeof(closes_minute) = 'integer'
      AND opens_minute >= 0 AND closes_minute <= 1440 AND opens_minute < closes_minute)
  )
);
-- A date-specific row overrides the local weekday; null hours mean closed.
CREATE UNIQUE INDEX staffed_calendar_weekday ON staffed_calendar (area_id, weekday) WHERE weekday IS NOT NULL;
CREATE UNIQUE INDEX staffed_calendar_date ON staffed_calendar (area_id, local_date) WHERE local_date IS NOT NULL;

CREATE TABLE businesses (
  id TEXT PRIMARY KEY NOT NULL,
  legal_name TEXT NOT NULL,
  public_name TEXT NOT NULL,
  verified_work_contact TEXT NOT NULL,
  catchment_id TEXT NOT NULL REFERENCES operating_areas (id),
  default_foreman_id TEXT,
  state TEXT NOT NULL,
  CONSTRAINT businesses_state CHECK (state IN ('pending', 'approved', 'suspended', 'closed')),
  FOREIGN KEY (id, default_foreman_id) REFERENCES memberships (business_id, id)
);
CREATE INDEX businesses_catchment_state ON businesses (catchment_id, state, id);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  state TEXT NOT NULL,
  CONSTRAINT memberships_state CHECK (state IN ('active', 'revoked', 'suspended')),
  UNIQUE (business_id, account_id),
  UNIQUE (business_id, id),
  UNIQUE (id, business_id, account_id)
);
CREATE INDEX memberships_business_state ON memberships (business_id, state, id);
CREATE INDEX memberships_account_state ON memberships (account_id, state, id);

CREATE TABLE membership_roles (
  id TEXT PRIMARY KEY NOT NULL,
  membership_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES accounts (id),
  CONSTRAINT membership_roles_role CHECK (role IN ('worker', 'foreman', 'provider_admin')),
  CONSTRAINT membership_roles_revocation CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at >= granted_at AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  UNIQUE (id, business_id, account_id, role),
  FOREIGN KEY (membership_id, business_id, account_id) REFERENCES memberships (id, business_id, account_id)
);
CREATE UNIQUE INDEX membership_roles_current ON membership_roles (membership_id, role) WHERE revoked_at IS NULL;
CREATE INDEX membership_roles_membership_history ON membership_roles (membership_id, role, granted_at, id);
CREATE INDEX membership_roles_business_revoked ON membership_roles (business_id, revoked_at, id) WHERE revoked_at IS NOT NULL;

CREATE TABLE account_contexts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  role TEXT NOT NULL,
  business_id TEXT REFERENCES businesses (id),
  role_grant_id TEXT,
  CONSTRAINT account_contexts_role CHECK (role IN ('customer', 'worker', 'foreman', 'provider_admin')),
  CONSTRAINT account_contexts_scope CHECK (
    (role = 'customer' AND business_id IS NULL AND role_grant_id IS NULL)
    OR (role <> 'customer' AND business_id IS NOT NULL AND role_grant_id IS NOT NULL)
  ),
  UNIQUE (id, account_id),
  FOREIGN KEY (role_grant_id, business_id, account_id, role) REFERENCES membership_roles (id, business_id, account_id, role)
);
CREATE UNIQUE INDEX account_contexts_customer ON account_contexts (account_id) WHERE role = 'customer';
CREATE UNIQUE INDEX account_contexts_business_role ON account_contexts (account_id, role, business_id) WHERE business_id IS NOT NULL;
CREATE INDEX account_contexts_account ON account_contexts (account_id, id);
CREATE INDEX account_contexts_role_grant ON account_contexts (role_grant_id) WHERE role_grant_id IS NOT NULL;

CREATE TABLE places (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES accounts (id),
  named_approver_id TEXT,
  alias TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  address_revision INTEGER NOT NULL DEFAULT 0,
  pin TEXT,
  site_zone TEXT,
  area_id TEXT,
  safe_arrival_note TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  CONSTRAINT places_state CHECK (state IN ('pending_verification', 'in_area', 'out_of_area', 'restricted', 'archived')),
  CONSTRAINT places_revision CHECK (revision >= 0),
  CONSTRAINT places_address_revision CHECK (typeof(address_revision) = 'integer' AND address_revision >= 0),
  CONSTRAINT places_verified CHECK (
    (state NOT IN ('in_area', 'out_of_area') OR (pin IS NOT NULL AND site_zone IS NOT NULL AND named_approver_id IS NOT NULL))
    AND (state <> 'in_area' OR area_id IS NOT NULL)
    AND (area_id IS NULL OR site_zone IS NOT NULL)
  ),
  CONSTRAINT places_pin CHECK (
    CASE WHEN pin IS NULL THEN 1 WHEN json_valid(pin) THEN COALESCE(
      json_type(pin) = 'object'
      AND json_type(pin, '$.latitude') IN ('integer', 'real') AND json_extract(pin, '$.latitude') BETWEEN -90 AND 90
      AND json_type(pin, '$.longitude') IN ('integer', 'real') AND json_extract(pin, '$.longitude') BETWEEN -180 AND 180,
      0
    ) ELSE 0 END
  ),
  UNIQUE (id, address_revision),
  FOREIGN KEY (area_id, site_zone) REFERENCES operating_areas (id, site_zone),
  FOREIGN KEY (id, named_approver_id) REFERENCES place_people (place_id, current_account_id)
);
CREATE INDEX places_owner_state ON places (owner_id, state, id);
CREATE INDEX places_area_state ON places (area_id, state, id);

CREATE TRIGGER places_address_revision_change
BEFORE UPDATE OF normalized_address, address_revision ON places
WHEN NEW.address_revision <> OLD.address_revision + (NEW.normalized_address <> OLD.normalized_address)
BEGIN SELECT RAISE(ABORT, 'address change requires the next address revision'); END;

CREATE TABLE place_people (
  place_id TEXT NOT NULL REFERENCES places (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  verified_from INTEGER NOT NULL,
  history_from INTEGER NOT NULL,
  ends_at INTEGER,
  current_account_id TEXT GENERATED ALWAYS AS (CASE WHEN ends_at IS NULL THEN account_id END) VIRTUAL,
  PRIMARY KEY (place_id, account_id),
  UNIQUE (place_id, current_account_id),
  CONSTRAINT place_people_end CHECK (ends_at IS NULL OR ends_at >= verified_from)
);
CREATE INDEX place_people_account_current ON place_people (account_id, place_id) WHERE ends_at IS NULL;

CREATE TABLE authority_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT REFERENCES businesses (id),
  place_id TEXT REFERENCES places (id),
  address_revision INTEGER,
  subject_account_id TEXT REFERENCES accounts (id),
  kind TEXT NOT NULL,
  verified_by TEXT NOT NULL REFERENCES accounts (id),
  verified_at INTEGER NOT NULL,
  CONSTRAINT authority_verifications_scope CHECK (
    (business_id IS NOT NULL AND place_id IS NULL AND kind IN ('business', 'membership', 'business_grant'))
    OR (business_id IS NULL AND place_id IS NOT NULL AND kind IN ('place_pin', 'place_owner', 'place_approver', 'place_transfer', 'place_grant'))
  ),
  CONSTRAINT authority_verifications_address_revision CHECK (
    (place_id IS NULL AND address_revision IS NULL)
    OR (place_id IS NOT NULL AND typeof(address_revision) = 'integer' AND address_revision >= 0)
  ),
  CONSTRAINT authority_verifications_independent CHECK (subject_account_id IS NULL OR subject_account_id <> verified_by),
  UNIQUE (id, business_id),
  UNIQUE (id, place_id),
  UNIQUE (id, place_id, address_revision)
);
CREATE INDEX authority_verifications_business_subject ON authority_verifications (business_id, subject_account_id, kind, verified_at, id) WHERE business_id IS NOT NULL;
CREATE INDEX authority_verifications_place_subject ON authority_verifications (place_id, subject_account_id, kind, address_revision, verified_at, id) WHERE place_id IS NOT NULL;

CREATE TABLE business_grants (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  issuer_id TEXT NOT NULL REFERENCES accounts (id),
  approval_verification_id TEXT,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER,
  revoked_at INTEGER,
  CONSTRAINT business_grants_capability CHECK (capability IN (
    'handoff', 'backup_foreman', 'review_commercial', 'publish_commercial', 'issue_bill',
    'record_paid', 'billing_deferral', 'membership_admin', 'schedule_correction', 'feedback_lead'
  )),
  CONSTRAINT business_grants_term CHECK (
    (valid_until IS NULL OR (typeof(valid_until) = 'integer' AND valid_until > valid_from))
    AND (revoked_at IS NULL OR revoked_at >= valid_from)
  ),
  FOREIGN KEY (business_id, membership_id) REFERENCES memberships (business_id, id),
  FOREIGN KEY (approval_verification_id, business_id) REFERENCES authority_verifications (id, business_id)
);
CREATE UNIQUE INDEX business_grants_current ON business_grants (membership_id, capability) WHERE revoked_at IS NULL;
CREATE INDEX business_grants_scope ON business_grants (business_id, capability, id);
CREATE INDEX business_grants_due ON business_grants (valid_until, id) WHERE revoked_at IS NULL AND valid_until IS NOT NULL;

CREATE TABLE place_grants (
  id TEXT PRIMARY KEY NOT NULL,
  place_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  issuer_id TEXT NOT NULL REFERENCES accounts (id),
  approval_verification_id TEXT,
  address_revision INTEGER NOT NULL DEFAULT 0,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER,
  revoked_at INTEGER,
  -- Historical grants keep their issuing address revision; live protected grants must match the place.
  current_address_revision INTEGER GENERATED ALWAYS AS (
    CASE WHEN revoked_at IS NULL AND capability IN ('approve', 'book', 'request', 'sign_off') THEN address_revision END
  ) VIRTUAL,
  CONSTRAINT place_grants_capability CHECK (capability IN ('view', 'message', 'request', 'book', 'approve', 'sign_off', 'bill_view', 'delegate')),
  CONSTRAINT place_grants_term CHECK (
    (valid_until IS NULL OR (typeof(valid_until) = 'integer' AND valid_until > valid_from))
    AND (revoked_at IS NULL OR revoked_at >= valid_from)
  ),
  CONSTRAINT place_grants_address_revision CHECK (typeof(address_revision) = 'integer' AND address_revision >= 0),
  FOREIGN KEY (place_id, account_id) REFERENCES place_people (place_id, account_id),
  FOREIGN KEY (place_id, current_address_revision) REFERENCES places (id, address_revision),
  FOREIGN KEY (approval_verification_id, place_id, address_revision) REFERENCES authority_verifications (id, place_id, address_revision)
);
CREATE UNIQUE INDEX place_grants_current ON place_grants (place_id, account_id, capability) WHERE revoked_at IS NULL;
-- Approval commands also require the exact current places.named_approver_id.
CREATE UNIQUE INDEX place_grants_current_approver ON place_grants (place_id) WHERE capability = 'approve' AND revoked_at IS NULL;
CREATE INDEX place_grants_grantee ON place_grants (account_id, place_id, id) WHERE revoked_at IS NULL;
CREATE INDEX place_grants_scope ON place_grants (place_id, account_id, id);
CREATE INDEX place_grants_due ON place_grants (valid_until, id) WHERE revoked_at IS NULL AND valid_until IS NOT NULL;

CREATE TABLE eligibility_checks (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  membership_id TEXT,
  trade TEXT NOT NULL,
  work_language TEXT NOT NULL,
  scope TEXT NOT NULL,
  state TEXT NOT NULL,
  checked_by TEXT REFERENCES accounts (id),
  checked_at INTEGER,
  valid_until INTEGER,
  review_by INTEGER,
  CONSTRAINT eligibility_checks_state CHECK (state IN ('pending', 'approved', 'suspended', 'rejected')),
  CONSTRAINT eligibility_checks_review CHECK (
    (checked_at IS NULL) = (checked_by IS NULL)
    AND (state = 'pending' OR checked_at IS NOT NULL)
    AND (state <> 'approved' OR valid_until IS NOT NULL OR review_by IS NOT NULL)
    AND (valid_until IS NULL OR (typeof(valid_until) = 'integer' AND checked_at IS NOT NULL AND valid_until > checked_at))
    AND (review_by IS NULL OR (typeof(review_by) = 'integer' AND (checked_at IS NULL OR review_by > checked_at)))
  ),
  FOREIGN KEY (business_id, membership_id) REFERENCES memberships (business_id, id)
);
CREATE INDEX eligibility_checks_subject ON eligibility_checks (business_id, membership_id, trade, work_language, checked_at, id);
CREATE INDEX eligibility_checks_expiry ON eligibility_checks (valid_until, id) WHERE state = 'approved' AND valid_until IS NOT NULL;
CREATE INDEX eligibility_checks_review_due ON eligibility_checks (state, review_by, id) WHERE review_by IS NOT NULL;

CREATE TABLE member_skills (
  membership_id TEXT NOT NULL REFERENCES memberships (id),
  tag TEXT NOT NULL,
  PRIMARY KEY (membership_id, tag)
);
CREATE INDEX member_skills_tag ON member_skills (tag, membership_id);

CREATE TABLE member_languages (
  membership_id TEXT NOT NULL REFERENCES memberships (id),
  tag TEXT NOT NULL,
  PRIMARY KEY (membership_id, tag)
);
CREATE INDEX member_languages_tag ON member_languages (tag, membership_id);

CREATE TABLE access_audit (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT REFERENCES businesses (id),
  place_id TEXT REFERENCES places (id),
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  subject_account_id TEXT REFERENCES accounts (id),
  verification_id TEXT,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  CONSTRAINT access_audit_scope CHECK ((business_id IS NULL) <> (place_id IS NULL)),
  CONSTRAINT access_audit_kind CHECK (kind IN (
    'role_granted', 'role_revoked', 'grant_issued', 'grant_revoked', 'membership_suspended',
    'eligibility_reviewed', 'place_verified', 'approver_changed', 'owner_transferred', 'place_archived',
    'invitation_issued', 'invitation_reissued', 'invitation_accepted', 'invitation_declined', 'invitation_withdrawn'
  )),
  FOREIGN KEY (verification_id, business_id) REFERENCES authority_verifications (id, business_id),
  FOREIGN KEY (verification_id, place_id) REFERENCES authority_verifications (id, place_id)
);
CREATE INDEX access_audit_business ON access_audit (business_id, at, id) WHERE business_id IS NOT NULL;
CREATE INDEX access_audit_place ON access_audit (place_id, at, id) WHERE place_id IS NOT NULL;
CREATE INDEX access_audit_subject ON access_audit (subject_account_id, at, id) WHERE subject_account_id IS NOT NULL;

CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_key TEXT NOT NULL,
  recipient_email_ciphertext TEXT,
  business_id TEXT REFERENCES businesses (id),
  place_id TEXT REFERENCES places (id),
  address_revision INTEGER,
  inviter_id TEXT NOT NULL REFERENCES accounts (id),
  grant_snapshot TEXT NOT NULL,
  verification_id TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  recipient_id TEXT REFERENCES accounts (id),
  supersedes_id TEXT UNIQUE,
  pending_slot INTEGER,
  state TEXT NOT NULL,
  CONSTRAINT invitations_state CHECK (state IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  CONSTRAINT invitations_scope CHECK ((business_id IS NULL) <> (place_id IS NULL)),
  CONSTRAINT invitations_address_revision CHECK (
    (place_id IS NULL AND address_revision IS NULL)
    OR (place_id IS NOT NULL AND typeof(address_revision) = 'integer' AND address_revision >= 0)
  ),
  CONSTRAINT invitations_lifetime CHECK (typeof(expires_at) = 'integer' AND expires_at = issued_at + 172800000),
  CONSTRAINT invitations_resolution CHECK (
    (state = 'pending') = (ended_at IS NULL)
    AND (ended_at IS NULL OR ended_at >= issued_at)
    AND (state <> 'pending' OR recipient_email_ciphertext IS NOT NULL)
    AND (state NOT IN ('accepted', 'declined') OR (recipient_id IS NOT NULL AND ended_at < expires_at))
  ),
  CONSTRAINT invitations_slot CHECK (
    (pending_slot IS NULL OR (place_id IS NOT NULL AND typeof(pending_slot) = 'integer' AND pending_slot BETWEEN 1 AND 5))
    AND (place_id IS NULL OR state <> 'pending' OR pending_slot IS NOT NULL)
  ),
  CONSTRAINT invitations_snapshot CHECK (
    CASE WHEN json_valid(grant_snapshot) THEN COALESCE(
      (business_id IS NOT NULL AND json_extract(grant_snapshot, '$.kind') = 'business_role'
        AND json_extract(grant_snapshot, '$.role') IN ('worker', 'foreman'))
      OR (place_id IS NOT NULL AND json_extract(grant_snapshot, '$.kind') = 'place_view')
      OR (place_id IS NOT NULL AND json_extract(grant_snapshot, '$.kind') = 'place_transfer' AND verification_id IS NOT NULL),
      0
    ) ELSE 0 END
  ),
  CONSTRAINT invitations_reissue CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  UNIQUE (business_id, recipient_key, id),
  UNIQUE (place_id, recipient_key, id),
  FOREIGN KEY (verification_id, business_id) REFERENCES authority_verifications (id, business_id),
  FOREIGN KEY (verification_id, place_id, address_revision) REFERENCES authority_verifications (id, place_id, address_revision),
  FOREIGN KEY (business_id, recipient_key, supersedes_id) REFERENCES invitations (business_id, recipient_key, id),
  FOREIGN KEY (place_id, recipient_key, supersedes_id) REFERENCES invitations (place_id, recipient_key, id)
);
-- A command first closes any expired or replaced pending rows in its guarded batch.
CREATE UNIQUE INDEX invitations_business_pending_recipient ON invitations (business_id, recipient_key) WHERE state = 'pending' AND business_id IS NOT NULL;
CREATE UNIQUE INDEX invitations_place_pending_recipient ON invitations (place_id, recipient_key) WHERE state = 'pending' AND place_id IS NOT NULL;
CREATE UNIQUE INDEX invitations_place_pending_slot ON invitations (place_id, pending_slot) WHERE state = 'pending' AND place_id IS NOT NULL;
CREATE INDEX invitations_business_delivery ON invitations (business_id, recipient_key, issued_at, id) WHERE business_id IS NOT NULL;
CREATE INDEX invitations_place_reissue ON invitations (place_id, recipient_key, issued_at, id) WHERE supersedes_id IS NOT NULL AND place_id IS NOT NULL;
CREATE INDEX invitations_business_state ON invitations (business_id, state, issued_at, id) WHERE business_id IS NOT NULL;
CREATE INDEX invitations_place_state ON invitations (place_id, state, issued_at, id) WHERE place_id IS NOT NULL;
CREATE INDEX invitations_pending_due ON invitations (expires_at, id) WHERE state = 'pending';
CREATE INDEX invitations_recipient ON invitations (recipient_id, issued_at, id) WHERE recipient_id IS NOT NULL;

CREATE TABLE assignments (
  id TEXT PRIMARY KEY NOT NULL,
  slot_id TEXT NOT NULL REFERENCES shift_slots (id),
  worker_membership_id TEXT NOT NULL REFERENCES memberships (id),
  cover_gap_id TEXT,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  confirmed_by TEXT NOT NULL REFERENCES accounts (id),
  confirmed_at INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  dropped_at INTEGER,
  dropout_reported_by TEXT REFERENCES accounts (id),
  dropout_source TEXT,
  dropout_reason TEXT,
  CONSTRAINT assignments_state CHECK (state IN ('confirmed', 'dropped', 'released', 'completed')),
  CONSTRAINT assignments_source CHECK (
    (source = 'ordinary' AND cover_gap_id IS NULL) OR (source = 'cover' AND cover_gap_id IS NOT NULL)
  ),
  CONSTRAINT assignments_times CHECK (
    typeof(confirmed_at) = 'integer' AND typeof(starts_at) = 'integer'
    AND typeof(ends_at) = 'integer' AND starts_at < ends_at
  ),
  CONSTRAINT assignments_dropout CHECK (
    (state = 'dropped' AND typeof(dropped_at) = 'integer' AND dropped_at >= confirmed_at
      AND dropout_reported_by IS NOT NULL AND dropout_source IS NOT NULL AND dropout_source IN ('self', 'phone_report')
      AND (dropout_reason IS NULL OR dropout_reason IN ('transport', 'another_job', 'personal')))
    OR (state <> 'dropped' AND dropped_at IS NULL AND dropout_reported_by IS NULL
      AND dropout_source IS NULL AND dropout_reason IS NULL)
  ),
  UNIQUE (slot_id, id),
  FOREIGN KEY (slot_id, cover_gap_id) REFERENCES cover_gaps (slot_id, id)
);
CREATE UNIQUE INDEX assignments_one_live_slot ON assignments (slot_id) WHERE state = 'confirmed';
CREATE UNIQUE INDEX assignments_one_cover_gap ON assignments (cover_gap_id) WHERE cover_gap_id IS NOT NULL;
CREATE INDEX assignments_worker_active_interval ON assignments (worker_membership_id, starts_at, ends_at, id)
  WHERE state = 'confirmed';

CREATE TABLE assignment_offers (
  id TEXT PRIMARY KEY NOT NULL,
  slot_id TEXT NOT NULL REFERENCES shift_slots (id),
  recipient_id TEXT NOT NULL REFERENCES memberships (id),
  issued_by TEXT NOT NULL REFERENCES accounts (id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  resolved_at INTEGER,
  assignment_id TEXT UNIQUE,
  decline_reason TEXT,
  CONSTRAINT assignment_offers_state CHECK (state IN ('offered', 'confirmed', 'declined', 'withdrawn', 'expired')),
  CONSTRAINT assignment_offers_times CHECK (
    typeof(issued_at) = 'integer' AND typeof(expires_at) = 'integer' AND issued_at < expires_at
    AND ((state = 'offered' AND resolved_at IS NULL)
      OR (state <> 'offered' AND typeof(resolved_at) = 'integer' AND issued_at <= resolved_at
        AND (state = 'expired') = (resolved_at >= expires_at)))
  ),
  CONSTRAINT assignment_offers_assignment CHECK ((state = 'confirmed') = (assignment_id IS NOT NULL)),
  CONSTRAINT assignment_offers_decline_reason CHECK (
    decline_reason IS NULL OR (state = 'declined' AND decline_reason IN ('busy_then', 'too_far_away'))
  ),
  FOREIGN KEY (slot_id, assignment_id) REFERENCES assignments (slot_id, id)
);
CREATE UNIQUE INDEX assignment_offers_one_live_slot ON assignment_offers (slot_id) WHERE state = 'offered';
CREATE INDEX assignment_offers_slot_issued ON assignment_offers (slot_id, issued_at, id);
CREATE INDEX assignment_offers_recipient_state ON assignment_offers (recipient_id, state, expires_at, id);
CREATE INDEX assignment_offers_due ON assignment_offers (expires_at, id) WHERE state = 'offered';

CREATE TABLE cover_gaps (
  id TEXT PRIMARY KEY NOT NULL,
  slot_id TEXT NOT NULL REFERENCES shift_slots (id),
  prior_assignment_id TEXT NOT NULL UNIQUE,
  safe_cutoff INTEGER NOT NULL,
  current_round_no INTEGER,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  revised_window_id TEXT REFERENCES visit_windows (id),
  CONSTRAINT cover_gaps_state CHECK (state IN ('open', 'accepted_pending_confirmation', 'filled', 'closed')),
  CONSTRAINT cover_gaps_revision CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CONSTRAINT cover_gaps_cutoff CHECK (typeof(safe_cutoff) = 'integer'),
  CONSTRAINT cover_gaps_round CHECK (current_round_no IS NOT NULL OR state IN ('open', 'closed')),
  CONSTRAINT cover_gaps_close CHECK (
    (state = 'closed' AND typeof(closed_at) = 'integer')
    OR (state <> 'closed' AND closed_at IS NULL AND revised_window_id IS NULL)
  ),
  UNIQUE (slot_id, id),
  FOREIGN KEY (slot_id, prior_assignment_id) REFERENCES assignments (slot_id, id),
  FOREIGN KEY (id, current_round_no) REFERENCES cover_rounds (gap_id, round_no)
);
CREATE UNIQUE INDEX cover_gaps_one_open_slot ON cover_gaps (slot_id)
  WHERE state IN ('open', 'accepted_pending_confirmation');
CREATE INDEX cover_gaps_due ON cover_gaps (safe_cutoff, id)
  WHERE state IN ('open', 'accepted_pending_confirmation');

CREATE TABLE cover_dispatches (
  gap_id TEXT NOT NULL REFERENCES cover_gaps (id),
  dispatch_no INTEGER NOT NULL,
  issued_by TEXT NOT NULL REFERENCES accounts (id),
  issued_at INTEGER NOT NULL,
  reply_until INTEGER NOT NULL,
  state TEXT NOT NULL,
  closed_at INTEGER,
  PRIMARY KEY (gap_id, dispatch_no),
  CONSTRAINT cover_dispatches_number CHECK (typeof(dispatch_no) = 'integer' AND dispatch_no BETWEEN 1 AND 2),
  CONSTRAINT cover_dispatches_reply CHECK (
    typeof(issued_at) = 'integer' AND typeof(reply_until) = 'integer'
    AND reply_until - issued_at BETWEEN 300000 AND 900000
  ),
  CONSTRAINT cover_dispatches_state CHECK (
    (state = 'open' AND closed_at IS NULL)
    OR (state = 'closed' AND typeof(closed_at) = 'integer' AND issued_at <= closed_at)
  )
);
CREATE UNIQUE INDEX cover_dispatches_one_open ON cover_dispatches (gap_id) WHERE state = 'open';
CREATE INDEX cover_dispatches_due ON cover_dispatches (reply_until, gap_id, dispatch_no) WHERE state = 'open';

CREATE TABLE cover_offers (
  id TEXT PRIMARY KEY NOT NULL,
  gap_id TEXT NOT NULL,
  dispatch_no INTEGER NOT NULL,
  recipient_id TEXT NOT NULL REFERENCES memberships (id),
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  responded_at INTEGER,
  decline_reason TEXT,
  CONSTRAINT cover_offers_expiry CHECK (typeof(expires_at) = 'integer'),
  CONSTRAINT cover_offers_state CHECK (
    (state = 'offered' AND responded_at IS NULL)
    OR (state IN ('declined', 'withdrawn') AND typeof(responded_at) = 'integer')
  ),
  CONSTRAINT cover_offers_decline_reason CHECK (
    decline_reason IS NULL OR (state = 'declined' AND decline_reason IN ('busy_then', 'too_far_away'))
  ),
  UNIQUE (gap_id, dispatch_no, recipient_id),
  UNIQUE (gap_id, dispatch_no, id),
  FOREIGN KEY (gap_id, dispatch_no) REFERENCES cover_dispatches (gap_id, dispatch_no)
);
CREATE INDEX cover_offers_recipient_expiry ON cover_offers (recipient_id, expires_at, id);

-- Release/lapse closes the round, never clears its winner. While the dispatch's
-- reply window remains usable, a new round can reuse its still-offered rows.
CREATE TABLE cover_rounds (
  gap_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  dispatch_no INTEGER NOT NULL,
  state TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  winner_offer_id TEXT,
  accepted_at INTEGER,
  confirm_by INTEGER,
  ended_at INTEGER,
  PRIMARY KEY (gap_id, round_no),
  CONSTRAINT cover_rounds_number CHECK (typeof(round_no) = 'integer' AND round_no >= 1),
  CONSTRAINT cover_rounds_state CHECK (state IN ('open', 'accepted_pending_confirmation', 'confirmed', 'closed')),
  CONSTRAINT cover_rounds_winner CHECK (
    (winner_offer_id IS NULL AND accepted_at IS NULL AND confirm_by IS NULL AND state IN ('open', 'closed'))
    OR (winner_offer_id IS NOT NULL AND state <> 'open'
      AND typeof(accepted_at) = 'integer' AND typeof(confirm_by) = 'integer'
      AND opened_at <= accepted_at AND accepted_at < confirm_by AND confirm_by - accepted_at <= 300000)
  ),
  CONSTRAINT cover_rounds_times CHECK (
    typeof(opened_at) = 'integer' AND (
      (state IN ('open', 'accepted_pending_confirmation') AND ended_at IS NULL)
      OR (state IN ('closed', 'confirmed') AND typeof(ended_at) = 'integer'
        AND ended_at >= coalesce(accepted_at, opened_at) AND (state = 'closed' OR ended_at < confirm_by))
    )
  ),
  FOREIGN KEY (gap_id, dispatch_no) REFERENCES cover_dispatches (gap_id, dispatch_no),
  FOREIGN KEY (gap_id, dispatch_no, winner_offer_id) REFERENCES cover_offers (gap_id, dispatch_no, id)
);
CREATE UNIQUE INDEX cover_rounds_one_live_gap ON cover_rounds (gap_id)
  WHERE state IN ('open', 'accepted_pending_confirmation');
CREATE INDEX cover_rounds_dispatch ON cover_rounds (gap_id, dispatch_no, round_no);
CREATE INDEX cover_rounds_winner_offer ON cover_rounds (gap_id, dispatch_no, winner_offer_id) WHERE winner_offer_id IS NOT NULL;
CREATE INDEX cover_rounds_due ON cover_rounds (confirm_by, gap_id, round_no) WHERE state = 'accepted_pending_confirmation';

-- Accept with a CAS on the gap's current round and revision, open round,
-- intended live offer and current eligibility. Advance gap and round in one
-- batch; a losing CAS must not write a receipt or close sibling offers.
CREATE TRIGGER cover_rounds_lock_winner BEFORE UPDATE ON cover_rounds
WHEN OLD.winner_offer_id IS NOT NULL AND (
  NEW.winner_offer_id IS NOT OLD.winner_offer_id OR NEW.accepted_at IS NOT OLD.accepted_at
  OR NEW.confirm_by IS NOT OLD.confirm_by OR NEW.gap_id IS NOT OLD.gap_id
  OR NEW.dispatch_no IS NOT OLD.dispatch_no OR NEW.round_no IS NOT OLD.round_no
)
BEGIN
  SELECT RAISE(ABORT, 'cover round winner is immutable');
END;
CREATE TRIGGER cover_rounds_keep_winner BEFORE DELETE ON cover_rounds
WHEN OLD.winner_offer_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'cover round winner is immutable');
END;
CREATE TRIGGER cover_rounds_no_replace BEFORE INSERT ON cover_rounds
WHEN EXISTS (
  SELECT 1 FROM cover_rounds
  WHERE gap_id = NEW.gap_id AND round_no = NEW.round_no AND winner_offer_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'cover round winner is immutable');
END;

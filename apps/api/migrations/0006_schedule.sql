CREATE TABLE visits (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  cancelled_at INTEGER,
  cancelled_by TEXT REFERENCES accounts (id),
  CONSTRAINT visits_kind CHECK (kind IN ('assessment', 'work')),
  CONSTRAINT visits_state CHECK (state IN ('planned', 'booked', 'cancelled', 'finished')),
  CONSTRAINT visits_revision CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CONSTRAINT visits_cancellation CHECK (
    (state = 'cancelled' AND typeof(cancelled_at) = 'integer' AND cancelled_by IS NOT NULL)
    OR (state <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL)
  )
);
CREATE INDEX visits_job_state ON visits (job_id, state, id);

-- A visit, shift, or slot cannot acquire another job's staffing history by reparenting.
CREATE TRIGGER visits_keep_job BEFORE UPDATE OF id, job_id ON visits
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id
BEGIN SELECT RAISE(ABORT, 'visit job is immutable'); END;
CREATE TRIGGER visits_keep_job_on_insert BEFORE INSERT ON visits
WHEN EXISTS (SELECT 1 FROM visits WHERE id = NEW.id AND job_id <> NEW.job_id)
BEGIN SELECT RAISE(ABORT, 'visit job is immutable'); END;

CREATE TABLE reschedule_requests (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits (id),
  requester_id TEXT NOT NULL REFERENCES accounts (id),
  state TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  reply_by INTEGER NOT NULL,
  CONSTRAINT reschedule_requests_state CHECK (state IN ('requested', 'proposed', 'accepted', 'declined', 'withdrawn')),
  CONSTRAINT reschedule_requests_reply CHECK (
    typeof(requested_at) = 'integer' AND typeof(reply_by) = 'integer' AND reply_by >= requested_at
  ),
  UNIQUE (visit_id, id)
);
CREATE INDEX reschedule_requests_visit_state ON reschedule_requests (visit_id, state, requested_at, id);
CREATE INDEX reschedule_requests_due ON reschedule_requests (reply_by, id) WHERE state = 'requested';

-- Proposals reserve no capacity. A move supersedes the still-confirmed window
-- and confirms its exact replacement in one guarded command batch.
CREATE TABLE visit_windows (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits (id),
  replaces_window_id TEXT,
  reschedule_request_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  provider_authorized INTEGER NOT NULL,
  proposed_at INTEGER NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES accounts (id),
  confirmed_at INTEGER,
  confirmed_by TEXT REFERENCES accounts (id),
  state TEXT NOT NULL,
  CONSTRAINT visit_windows_state CHECK (state IN ('proposed', 'confirmed', 'withdrawn', 'superseded', 'cancelled')),
  CONSTRAINT visit_windows_times CHECK (
    typeof(proposed_at) = 'integer' AND typeof(starts_at) = 'integer'
    AND typeof(ends_at) = 'integer' AND typeof(expires_at) = 'integer'
    AND proposed_at < expires_at AND expires_at <= starts_at AND starts_at < ends_at
  ),
  CONSTRAINT visit_windows_authorization CHECK (typeof(provider_authorized) = 'integer' AND provider_authorized IN (0, 1)),
  CONSTRAINT visit_windows_confirmation CHECK (
    (confirmed_at IS NULL AND confirmed_by IS NULL AND state NOT IN ('confirmed', 'superseded'))
    OR (typeof(confirmed_at) = 'integer' AND confirmed_by IS NOT NULL AND provider_authorized = 1
      AND proposed_at <= confirmed_at AND confirmed_at < expires_at AND state IN ('confirmed', 'superseded', 'cancelled'))
  ),
  CONSTRAINT visit_windows_replacement CHECK (replaces_window_id IS NULL OR replaces_window_id <> id),
  UNIQUE (visit_id, id),
  FOREIGN KEY (visit_id, replaces_window_id) REFERENCES visit_windows (visit_id, id),
  FOREIGN KEY (visit_id, reschedule_request_id) REFERENCES reschedule_requests (visit_id, id)
);
CREATE UNIQUE INDEX visit_windows_one_confirmed ON visit_windows (visit_id) WHERE state = 'confirmed';
CREATE INDEX visit_windows_visit_start ON visit_windows (visit_id, starts_at, id);
CREATE INDEX visit_windows_due ON visit_windows (expires_at, id) WHERE state = 'proposed';
CREATE INDEX visit_windows_replaces ON visit_windows (visit_id, replaces_window_id) WHERE replaces_window_id IS NOT NULL;
CREATE INDEX visit_windows_request ON visit_windows (visit_id, reschedule_request_id) WHERE reschedule_request_id IS NOT NULL;

CREATE TABLE shifts (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits (id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  skill TEXT NOT NULL,
  briefing_language TEXT NOT NULL,
  state TEXT NOT NULL,
  CONSTRAINT shifts_times CHECK (typeof(starts_at) = 'integer' AND typeof(ends_at) = 'integer' AND starts_at < ends_at),
  CONSTRAINT shifts_state CHECK (state IN ('planned', 'active', 'finished', 'cancelled'))
);
CREATE INDEX shifts_visit_start ON shifts (visit_id, starts_at, id);

CREATE TRIGGER shifts_keep_visit BEFORE UPDATE OF id, visit_id ON shifts
WHEN NEW.id IS NOT OLD.id OR NEW.visit_id IS NOT OLD.visit_id
BEGIN SELECT RAISE(ABORT, 'shift visit is immutable'); END;
CREATE TRIGGER shifts_keep_visit_on_insert BEFORE INSERT ON shifts
WHEN EXISTS (SELECT 1 FROM shifts WHERE id = NEW.id AND visit_id <> NEW.visit_id)
BEGIN SELECT RAISE(ABORT, 'shift visit is immutable'); END;

CREATE TABLE shift_slots (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL REFERENCES shifts (id),
  number INTEGER NOT NULL,
  is_lead INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT shift_slots_number CHECK (typeof(number) = 'integer' AND number >= 1),
  CONSTRAINT shift_slots_lead CHECK (typeof(is_lead) = 'integer' AND is_lead IN (0, 1)),
  UNIQUE (shift_id, number)
);
CREATE UNIQUE INDEX shift_slots_one_lead ON shift_slots (shift_id) WHERE is_lead = 1;

CREATE TRIGGER shift_slots_keep_shift BEFORE UPDATE OF id, shift_id ON shift_slots
WHEN NEW.id IS NOT OLD.id OR NEW.shift_id IS NOT OLD.shift_id
BEGIN SELECT RAISE(ABORT, 'slot shift is immutable'); END;
CREATE TRIGGER shift_slots_keep_shift_on_insert BEFORE INSERT ON shift_slots
WHEN EXISTS (SELECT 1 FROM shift_slots WHERE id = NEW.id AND shift_id <> NEW.shift_id)
BEGIN SELECT RAISE(ABORT, 'slot shift is immutable'); END;

-- Dated intervals are UTC instants. Recurring rules are ISO weekdays (1–7)
-- with local clock offsets, resolved in the membership's business zone for
-- each date. Dated preferences override recurrence; neither edits a shift.
CREATE TABLE availability_intervals (
  id TEXT PRIMARY KEY NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships (id),
  week_day_or_date TEXT NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  starts_offset_ms INTEGER,
  ends_offset_ms INTEGER,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  open_to_cover INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT NOT NULL REFERENCES accounts (id),
  recorded_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT availability_intervals_kind CHECK (kind IN ('available', 'unavailable', 'duty')),
  CONSTRAINT availability_intervals_source CHECK (source IN ('worker', 'employer') AND (kind <> 'duty' OR source = 'employer')),
  CONSTRAINT availability_intervals_cover CHECK (
    typeof(open_to_cover) = 'integer' AND open_to_cover IN (0, 1) AND (open_to_cover = 0 OR kind = 'available')
  ),
  CONSTRAINT availability_intervals_record CHECK (typeof(recorded_at) = 'integer' AND typeof(revision) = 'integer' AND revision >= 0),
  CONSTRAINT availability_intervals_period CHECK (
    (week_day_or_date IN ('1', '2', '3', '4', '5', '6', '7')
      AND starts_at IS NULL AND ends_at IS NULL
      AND typeof(starts_offset_ms) = 'integer' AND typeof(ends_offset_ms) = 'integer'
      AND 0 <= starts_offset_ms AND starts_offset_ms < ends_offset_ms AND ends_offset_ms <= 86400000)
    OR (week_day_or_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(week_day_or_date, '+0 days') IS week_day_or_date
      AND typeof(starts_at) = 'integer' AND typeof(ends_at) = 'integer' AND starts_at < ends_at
      AND starts_offset_ms IS NULL AND ends_offset_ms IS NULL)
  )
);
CREATE INDEX availability_intervals_member_day ON availability_intervals (membership_id, week_day_or_date, starts_at, id);

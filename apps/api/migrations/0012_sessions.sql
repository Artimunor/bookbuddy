CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  area_id TEXT NOT NULL,
  site_zone TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  locality TEXT NOT NULL CHECK (length(trim(locality)) > 0),
  address TEXT NOT NULL CHECK (length(trim(address)) > 0),
  access_note TEXT NOT NULL CHECK (length(trim(access_note)) > 0),
  arrival_note TEXT NOT NULL CHECK (length(trim(arrival_note)) > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'retired')),
  approved_at INTEGER,
  CONSTRAINT venues_approval CHECK ((approved_at IS NULL OR typeof(approved_at) = 'integer')
    AND (state <> 'approved' OR approved_at IS NOT NULL)),
  FOREIGN KEY (area_id, site_zone) REFERENCES operating_areas (id, site_zone),
  UNIQUE (id, business_id)
);
CREATE INDEX venues_area_locality ON venues (area_id, locality, state, id);
CREATE INDEX venues_business_state ON venues (business_id, state, id);

-- A verified address/access record can be retired, not rewritten beneath a booking.
CREATE TRIGGER venues_verified_snapshot BEFORE UPDATE ON venues
WHEN OLD.approved_at IS NOT NULL AND (
  NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id OR NEW.area_id IS NOT OLD.area_id
  OR NEW.site_zone IS NOT OLD.site_zone OR NEW.name IS NOT OLD.name OR NEW.locality IS NOT OLD.locality
  OR NEW.address IS NOT OLD.address OR NEW.access_note IS NOT OLD.access_note OR NEW.arrival_note IS NOT OLD.arrival_note
  OR NEW.approved_at IS NOT OLD.approved_at
)
BEGIN SELECT RAISE(ABORT, 'verified session venue is immutable'); END;

CREATE TABLE session_listings (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 64 AND category NOT GLOB '*[^a-z0-9_-]*'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  UNIQUE (id, business_id)
);
CREATE INDEX session_listings_business_category ON session_listings (business_id, category, id);

CREATE TABLE session_listing_versions (
  id TEXT PRIMARY KEY NOT NULL,
  listing_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  no INTEGER NOT NULL CHECK (typeof(no) = 'integer' AND no > 0),
  venue_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  original_locale TEXT NOT NULL CHECK (length(original_locale) > 0),
  language TEXT NOT NULL CHECK (length(language) > 0),
  format TEXT NOT NULL CHECK (format IN ('group', 'private')),
  duration_ms INTEGER NOT NULL CHECK (typeof(duration_ms) = 'integer' AND duration_ms > 0),
  guaranteed_host_membership_id TEXT,
  price_minor INTEGER NOT NULL CHECK (typeof(price_minor) = 'integer' AND price_minor >= 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  price_basis TEXT NOT NULL CHECK (price_basis IN ('per_person', 'per_appointment')),
  terms_text TEXT NOT NULL CHECK (length(trim(terms_text)) > 0),
  terms_locale TEXT NOT NULL CHECK (length(terms_locale) > 0),
  terms_hash TEXT NOT NULL CHECK (length(terms_hash) BETWEEN 1 AND 128),
  cancellation_notice_ms INTEGER NOT NULL CHECK (typeof(cancellation_notice_ms) = 'integer' AND cancellation_notice_ms >= 0),
  created_by_id TEXT NOT NULL REFERENCES accounts (id),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
  CONSTRAINT session_listing_versions_format_basis CHECK ((format = 'private') = (price_basis = 'per_appointment')),
  FOREIGN KEY (listing_id, business_id) REFERENCES session_listings (id, business_id),
  FOREIGN KEY (venue_id, business_id) REFERENCES venues (id, business_id),
  FOREIGN KEY (business_id, guaranteed_host_membership_id) REFERENCES memberships (business_id, id),
  UNIQUE (listing_id, no),
  UNIQUE (id, listing_id),
  UNIQUE (id, listing_id, terms_hash)
);
CREATE INDEX session_listing_versions_venue ON session_listing_versions (venue_id, business_id);
CREATE TRIGGER session_listing_versions_no_update BEFORE UPDATE ON session_listing_versions
BEGIN SELECT RAISE(ABORT, 'session listing versions are immutable'); END;
CREATE TRIGGER session_listing_versions_no_delete BEFORE DELETE ON session_listing_versions
BEGIN SELECT RAISE(ABORT, 'session listing versions are immutable'); END;
-- REPLACE does not fire delete triggers when recursive triggers are off.
CREATE TRIGGER session_listing_versions_no_replace BEFORE INSERT ON session_listing_versions
WHEN EXISTS (SELECT 1 FROM session_listing_versions WHERE id = NEW.id OR (listing_id = NEW.listing_id AND no = NEW.no))
BEGIN SELECT RAISE(ABORT, 'session listing versions are immutable'); END;

CREATE TABLE session_slots (
  id TEXT PRIMARY KEY NOT NULL,
  listing_id TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK (typeof(capacity) = 'integer' AND capacity > 0),
  hosts_required INTEGER NOT NULL CHECK (typeof(hosts_required) = 'integer' AND hosts_required > 0),
  coordinator_membership_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'paused', 'cancelled', 'finished')),
  day_stage TEXT CHECK (day_stage IN ('today', 'doors_open', 'in_session', 'done')),
  stage_at INTEGER,
  stage_by_id TEXT REFERENCES accounts (id),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CONSTRAINT session_slots_time CHECK (typeof(starts_at) = 'integer' AND typeof(ends_at) = 'integer' AND ends_at > starts_at),
  CONSTRAINT session_slots_coordinator CHECK (state IN ('draft', 'cancelled') OR coordinator_membership_id IS NOT NULL),
  CONSTRAINT session_slots_day_stage CHECK ((state = 'finished') = (day_stage IS 'done') AND (
    (day_stage IS NULL AND stage_at IS NULL AND stage_by_id IS NULL)
    OR (day_stage IS NOT NULL AND typeof(stage_at) = 'integer' AND stage_by_id IS NOT NULL)
  )),
  FOREIGN KEY (listing_id, business_id) REFERENCES session_listings (id, business_id),
  FOREIGN KEY (listing_version_id, listing_id) REFERENCES session_listing_versions (id, listing_id),
  FOREIGN KEY (business_id, coordinator_membership_id) REFERENCES memberships (business_id, id),
  UNIQUE (id, listing_id),
  UNIQUE (id, business_id)
);
CREATE INDEX session_slots_listing_start ON session_slots (listing_id, starts_at, id);
CREATE UNIQUE INDEX session_slots_published_start ON session_slots (listing_id, starts_at) WHERE state = 'published';

-- A private appointment reserves the whole slot. Publication uses the verified
-- venue and exact advertised duration; drafts can wait for venue approval.
CREATE TRIGGER session_slots_publish_insert BEFORE INSERT ON session_slots
WHEN NEW.state = 'published' AND NOT EXISTS (
  SELECT 1 FROM session_listing_versions AS version
  JOIN venues AS venue ON venue.id = version.venue_id AND venue.state = 'approved'
  WHERE version.id = NEW.listing_version_id AND version.duration_ms = NEW.ends_at - NEW.starts_at
    AND (version.format <> 'private' OR NEW.capacity = 1)
)
BEGIN SELECT RAISE(ABORT, 'session slot does not match approved listing'); END;
CREATE TRIGGER session_slots_publish_update BEFORE UPDATE OF state, listing_version_id, starts_at, ends_at, capacity ON session_slots
WHEN NEW.state = 'published' AND NOT EXISTS (
  SELECT 1 FROM session_listing_versions AS version
  JOIN venues AS venue ON venue.id = version.venue_id AND venue.state = 'approved'
  WHERE version.id = NEW.listing_version_id AND version.duration_ms = NEW.ends_at - NEW.starts_at
    AND (version.format <> 'private' OR NEW.capacity = 1)
)
BEGIN SELECT RAISE(ABORT, 'session slot does not match approved listing'); END;

CREATE TABLE session_holds (
  id TEXT PRIMARY KEY NOT NULL,
  slot_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  booker_id TEXT NOT NULL REFERENCES accounts (id),
  move_booking_id TEXT REFERENCES session_bookings (id),
  places INTEGER NOT NULL CHECK (typeof(places) = 'integer' AND places > 0),
  held_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'consumed', 'released')),
  resolved_at INTEGER,
  CONSTRAINT session_holds_deadline CHECK (typeof(held_at) = 'integer' AND typeof(expires_at) = 'integer' AND expires_at > held_at),
  CONSTRAINT session_holds_resolution CHECK (
    (state = 'held' AND resolved_at IS NULL) OR (state <> 'held' AND typeof(resolved_at) = 'integer'
      AND resolved_at >= held_at AND (state <> 'consumed' OR resolved_at < expires_at))
  ),
  FOREIGN KEY (slot_id, listing_id) REFERENCES session_slots (id, listing_id),
  FOREIGN KEY (listing_version_id, listing_id, terms_hash) REFERENCES session_listing_versions (id, listing_id, terms_hash)
);
-- Expired rows stop using seats at their deadline. Acquisition releases the booker's
-- expired held row first in the same batch; the unique index uses persisted state only.
CREATE UNIQUE INDEX session_holds_booker_current ON session_holds (booker_id) WHERE state = 'held';
CREATE INDEX session_holds_slot_deadline ON session_holds (slot_id, expires_at, id) WHERE state = 'held';

CREATE TABLE session_bookings (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  -- Reserve the opaque chat address when the booking is made; the thread row is lazy.
  thread_id TEXT NOT NULL UNIQUE DEFAULT ('session-' || lower(hex(randomblob(16)))),
  booker_id TEXT NOT NULL REFERENCES accounts (id),
  listing_id TEXT NOT NULL,
  original_hold_id TEXT NOT NULL UNIQUE REFERENCES session_holds (id),
  original_slot_id TEXT NOT NULL,
  original_listing_version_id TEXT NOT NULL,
  original_terms_hash TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  places INTEGER NOT NULL CHECK (typeof(places) = 'integer' AND places > 0),
  state TEXT NOT NULL CHECK (state IN ('booked', 'cancelled', 'completed')),
  booked_at INTEGER NOT NULL CHECK (typeof(booked_at) = 'integer'),
  cancelled_at INTEGER,
  cancelled_by_id TEXT REFERENCES accounts (id),
  completed_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  CONSTRAINT session_bookings_cancellation CHECK (
    (state <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by_id IS NULL) OR
    (state = 'cancelled' AND typeof(cancelled_at) = 'integer' AND cancelled_at >= booked_at AND cancelled_by_id IS NOT NULL)
  ),
  CONSTRAINT session_bookings_completion CHECK (
    (state <> 'completed' AND completed_at IS NULL) OR
    (state = 'completed' AND typeof(completed_at) = 'integer' AND completed_at >= booked_at)
  ),
  FOREIGN KEY (original_slot_id, listing_id) REFERENCES session_slots (id, listing_id),
  FOREIGN KEY (original_listing_version_id, listing_id, original_terms_hash) REFERENCES session_listing_versions (id, listing_id, terms_hash),
  FOREIGN KEY (slot_id, listing_id) REFERENCES session_slots (id, listing_id),
  FOREIGN KEY (listing_version_id, listing_id, terms_hash) REFERENCES session_listing_versions (id, listing_id, terms_hash),
  UNIQUE (id, listing_id)
);
CREATE INDEX session_bookings_booker ON session_bookings (booker_id, booked_at, id);
CREATE INDEX session_bookings_slot_state ON session_bookings (slot_id, state, id);

-- Holds are for fungible places. SQLite serializes writes; the capacity check and
-- insert share the same statement. Times are supplied by the server, never the caller.
CREATE TRIGGER session_holds_admit BEFORE INSERT ON session_holds
WHEN NEW.state <> 'held' OR NOT EXISTS (
  SELECT 1 FROM session_slots AS slot
  JOIN session_listing_versions AS version ON version.id = slot.listing_version_id
  JOIN venues AS venue ON venue.id = version.venue_id AND venue.state = 'approved'
  WHERE slot.id = NEW.slot_id AND slot.listing_id = NEW.listing_id AND slot.listing_version_id = NEW.listing_version_id
    AND slot.state = 'published' AND NEW.expires_at <= slot.starts_at
    AND (version.format <> 'private' OR NEW.places = 1)
    AND (NEW.move_booking_id IS NULL OR EXISTS (
      SELECT 1 FROM session_bookings AS booking WHERE booking.id = NEW.move_booking_id AND booking.state = 'booked'
        AND booking.booker_id = NEW.booker_id AND booking.listing_id = NEW.listing_id AND booking.places = NEW.places
        AND booking.slot_id <> NEW.slot_id
    ))
    AND NEW.places <= slot.capacity
      - COALESCE((SELECT sum(places) FROM session_holds WHERE slot_id = slot.id AND state = 'held' AND expires_at > NEW.held_at), 0)
      - COALESCE((SELECT sum(places) FROM session_bookings WHERE slot_id = slot.id AND state IN ('booked', 'completed')), 0)
      - COALESCE((SELECT sum(booking.places) FROM session_change_proposals AS offer
        JOIN session_bookings AS booking ON booking.id = offer.booking_id AND booking.state = 'booked'
          AND booking.slot_id = offer.booked_slot_id AND booking.listing_version_id = offer.booked_listing_version_id
        WHERE offer.proposed_slot_id = slot.id AND offer.booked_slot_id <> slot.id
          AND offer.state = 'pending' AND offer.respond_by > NEW.held_at), 0)
)
BEGIN SELECT RAISE(ABORT, 'session hold unavailable'); END;
CREATE TRIGGER session_holds_close BEFORE UPDATE ON session_holds
WHEN OLD.state <> 'held' OR NEW.state = 'held' OR NEW.id IS NOT OLD.id OR NEW.slot_id IS NOT OLD.slot_id
  OR NEW.listing_id IS NOT OLD.listing_id OR NEW.listing_version_id IS NOT OLD.listing_version_id OR NEW.terms_hash IS NOT OLD.terms_hash
  OR NEW.booker_id IS NOT OLD.booker_id OR NEW.move_booking_id IS NOT OLD.move_booking_id OR NEW.places IS NOT OLD.places
  OR NEW.held_at IS NOT OLD.held_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'only a held session hold can be resolved'); END;

CREATE TRIGGER session_slots_fixed_schedule BEFORE UPDATE OF starts_at, ends_at ON session_slots
WHEN (NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at)
  AND (OLD.state <> 'draft' OR EXISTS (SELECT 1 FROM session_holds WHERE slot_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'use a new slot for a changed published schedule'); END;
CREATE TRIGGER session_slots_capacity_floor BEFORE UPDATE OF capacity ON session_slots
WHEN NEW.capacity < OLD.capacity AND NEW.capacity <
    COALESCE((SELECT sum(places) FROM session_holds WHERE slot_id = OLD.id AND state = 'held' AND expires_at > NEW.updated_at), 0)
    + COALESCE((SELECT sum(places) FROM session_bookings WHERE slot_id = OLD.id AND state IN ('booked', 'completed')), 0)
    + COALESCE((SELECT sum(booking.places) FROM session_change_proposals AS offer
      JOIN session_bookings AS booking ON booking.id = offer.booking_id AND booking.state = 'booked'
        AND booking.slot_id = offer.booked_slot_id AND booking.listing_version_id = offer.booked_listing_version_id
      WHERE offer.proposed_slot_id = OLD.id AND offer.booked_slot_id <> OLD.id
        AND offer.state = 'pending' AND offer.respond_by > NEW.updated_at), 0)
BEGIN SELECT RAISE(ABORT, 'session capacity is committed'); END;

CREATE TRIGGER session_bookings_book_held_terms BEFORE INSERT ON session_bookings
WHEN NEW.state <> 'booked' OR NEW.slot_id <> NEW.original_slot_id
  OR NEW.listing_version_id <> NEW.original_listing_version_id OR NEW.terms_hash <> NEW.original_terms_hash
  OR NOT EXISTS (
    SELECT 1 FROM session_holds AS hold
    JOIN session_slots AS slot ON slot.id = hold.slot_id AND slot.listing_version_id = hold.listing_version_id
    JOIN session_listing_versions AS version ON version.id = hold.listing_version_id
    JOIN venues AS venue ON venue.id = version.venue_id AND venue.state = 'approved'
    WHERE hold.id = NEW.original_hold_id AND hold.booker_id = NEW.booker_id AND hold.places = NEW.places
      AND hold.listing_id = NEW.listing_id AND hold.slot_id = NEW.original_slot_id AND hold.move_booking_id IS NULL
      AND hold.listing_version_id = NEW.original_listing_version_id AND hold.terms_hash = NEW.original_terms_hash
      AND hold.state = 'held' AND NEW.booked_at >= hold.held_at AND NEW.booked_at < hold.expires_at AND slot.state = 'published'
)
BEGIN SELECT RAISE(ABORT, 'booking requires the exact active hold and terms'); END;
CREATE TRIGGER session_bookings_consume_hold AFTER INSERT ON session_bookings
BEGIN UPDATE session_holds SET state = 'consumed', resolved_at = NEW.booked_at WHERE id = NEW.original_hold_id; END;
-- A move or an accepted proposal may update the current snapshot, never the original acceptance.
CREATE TRIGGER session_bookings_keep_original BEFORE UPDATE ON session_bookings
WHEN NEW.id IS NOT OLD.id OR NEW.reference IS NOT OLD.reference OR NEW.booker_id IS NOT OLD.booker_id OR NEW.thread_id IS NOT OLD.thread_id
  OR NEW.listing_id IS NOT OLD.listing_id OR NEW.original_hold_id IS NOT OLD.original_hold_id OR NEW.original_slot_id IS NOT OLD.original_slot_id
  OR NEW.original_listing_version_id IS NOT OLD.original_listing_version_id OR NEW.original_terms_hash IS NOT OLD.original_terms_hash
  OR NEW.places IS NOT OLD.places OR NEW.booked_at IS NOT OLD.booked_at
BEGIN SELECT RAISE(ABORT, 'original booking terms are immutable'); END;

CREATE TABLE session_change_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  booked_slot_id TEXT NOT NULL,
  booked_listing_version_id TEXT NOT NULL,
  proposed_slot_id TEXT NOT NULL,
  proposed_listing_version_id TEXT NOT NULL,
  proposed_by_id TEXT NOT NULL REFERENCES accounts (id),
  proposed_at INTEGER NOT NULL,
  respond_by INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'withdrawn')),
  resolved_at INTEGER,
  resolved_by_id TEXT REFERENCES accounts (id),
  CONSTRAINT session_change_proposals_deadline CHECK (typeof(proposed_at) = 'integer' AND typeof(respond_by) = 'integer' AND respond_by > proposed_at),
  CONSTRAINT session_change_proposals_resolution CHECK (
    (state = 'pending' AND resolved_at IS NULL AND resolved_by_id IS NULL) OR (
      state <> 'pending' AND typeof(resolved_at) = 'integer' AND resolved_at >= proposed_at AND resolved_by_id IS NOT NULL
      AND (state = 'withdrawn' OR resolved_at < respond_by))
  ),
  FOREIGN KEY (booking_id, listing_id) REFERENCES session_bookings (id, listing_id),
  FOREIGN KEY (booked_slot_id, listing_id) REFERENCES session_slots (id, listing_id),
  FOREIGN KEY (booked_listing_version_id, listing_id) REFERENCES session_listing_versions (id, listing_id),
  FOREIGN KEY (proposed_slot_id, listing_id) REFERENCES session_slots (id, listing_id),
  FOREIGN KEY (proposed_listing_version_id, listing_id) REFERENCES session_listing_versions (id, listing_id),
  UNIQUE (booking_id, version)
);
CREATE UNIQUE INDEX session_change_proposals_pending ON session_change_proposals (booking_id) WHERE state = 'pending';
CREATE INDEX session_change_proposals_due ON session_change_proposals (respond_by, id) WHERE state = 'pending';
CREATE INDEX session_change_proposals_target ON session_change_proposals (proposed_slot_id, respond_by) WHERE state = 'pending';
CREATE TRIGGER session_change_proposals_keep_offer BEFORE UPDATE ON session_change_proposals
WHEN OLD.state <> 'pending' OR NEW.state = 'pending' OR NEW.id IS NOT OLD.id OR NEW.booking_id IS NOT OLD.booking_id
  OR NEW.listing_id IS NOT OLD.listing_id OR NEW.version IS NOT OLD.version OR NEW.booked_slot_id IS NOT OLD.booked_slot_id
  OR NEW.booked_listing_version_id IS NOT OLD.booked_listing_version_id OR NEW.proposed_slot_id IS NOT OLD.proposed_slot_id
  OR NEW.proposed_listing_version_id IS NOT OLD.proposed_listing_version_id OR NEW.proposed_by_id IS NOT OLD.proposed_by_id
  OR NEW.proposed_at IS NOT OLD.proposed_at OR NEW.respond_by IS NOT OLD.respond_by
BEGIN SELECT RAISE(ABORT, 'only the decision on a pending session proposal can change'); END;

CREATE TABLE session_host_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  slot_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position > 0),
  role_label TEXT NOT NULL CHECK (length(trim(role_label)) > 0),
  language TEXT NOT NULL CHECK (length(language) > 0),
  state TEXT NOT NULL CHECK (state IN ('proposed', 'confirmed', 'released')),
  changed_at INTEGER NOT NULL CHECK (typeof(changed_at) = 'integer'),
  changed_by_id TEXT NOT NULL REFERENCES accounts (id),
  confirmed_at INTEGER,
  offer_expires_at INTEGER,
  offer_responded_at INTEGER,
  offer_decision TEXT,
  CONSTRAINT session_host_assignments_confirmation CHECK (
    (state <> 'confirmed' OR confirmed_at IS NOT NULL)
    AND (confirmed_at IS NULL OR (typeof(confirmed_at) = 'integer' AND confirmed_at <= changed_at AND state <> 'proposed'))
  ),
  CONSTRAINT session_host_assignments_offer CHECK (
    (offer_expires_at IS NULL OR typeof(offer_expires_at) = 'integer') AND (
      (offer_responded_at IS NULL AND offer_decision IS NULL)
      OR (offer_expires_at IS NOT NULL AND typeof(offer_responded_at) = 'integer'
        AND offer_responded_at < offer_expires_at AND offer_responded_at <= changed_at
        AND offer_decision IS NOT NULL AND offer_decision IN ('accepted', 'declined'))
    ) AND (confirmed_at IS NULL OR offer_expires_at IS NULL OR offer_decision IS 'accepted')
  ),
  FOREIGN KEY (slot_id, business_id) REFERENCES session_slots (id, business_id),
  FOREIGN KEY (business_id, membership_id) REFERENCES memberships (business_id, id)
);
CREATE UNIQUE INDEX session_hosts_confirmed_position ON session_host_assignments (slot_id, position) WHERE state = 'confirmed';
CREATE UNIQUE INDEX session_hosts_current_member ON session_host_assignments (slot_id, membership_id)
  WHERE state IN ('proposed', 'confirmed') AND offer_decision IS NOT 'declined';
CREATE UNIQUE INDEX session_hosts_cover_reservation ON session_host_assignments (slot_id, position)
  WHERE state = 'proposed' AND offer_decision = 'accepted';
CREATE INDEX session_hosts_roster ON session_host_assignments (slot_id, state, id);
CREATE INDEX session_hosts_open_offers ON session_host_assignments (business_id, membership_id, offer_expires_at, id)
  WHERE state = 'proposed' AND offer_decision IS NULL AND offer_expires_at IS NOT NULL;

CREATE TABLE session_attendance (
  id TEXT PRIMARY KEY NOT NULL,
  booking_id TEXT NOT NULL REFERENCES session_bookings (id),
  result TEXT NOT NULL CHECK (result IN ('attended', 'absent')),
  places_attended INTEGER NOT NULL,
  recorded_by_id TEXT NOT NULL REFERENCES accounts (id),
  recorded_at INTEGER NOT NULL CHECK (typeof(recorded_at) = 'integer'),
  corrects_id TEXT UNIQUE,
  correction_reason TEXT,
  CONSTRAINT session_attendance_result_count CHECK (typeof(places_attended) = 'integer' AND (
    (result = 'attended' AND places_attended > 0) OR (result = 'absent' AND places_attended = 0)
  )),
  CONSTRAINT session_attendance_correction CHECK (
    (corrects_id IS NULL AND correction_reason IS NULL) OR
    (corrects_id IS NOT NULL AND corrects_id <> id AND correction_reason IS NOT NULL AND length(trim(correction_reason)) > 0)
  ),
  FOREIGN KEY (corrects_id, booking_id) REFERENCES session_attendance (id, booking_id),
  UNIQUE (id, booking_id)
);
CREATE UNIQUE INDEX session_attendance_one_verified ON session_attendance (booking_id) WHERE corrects_id IS NULL;
CREATE INDEX session_attendance_history ON session_attendance (booking_id, recorded_at, id);
CREATE TRIGGER session_attendance_admit BEFORE INSERT ON session_attendance
WHEN NEW.places_attended > (SELECT places FROM session_bookings WHERE id = NEW.booking_id)
  OR (NEW.corrects_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM session_attendance WHERE id = NEW.corrects_id AND booking_id = NEW.booking_id AND recorded_at <= NEW.recorded_at
  ))
BEGIN SELECT RAISE(ABORT, 'invalid session attendance result or correction'); END;
CREATE TRIGGER session_attendance_no_update BEFORE UPDATE ON session_attendance
BEGIN SELECT RAISE(ABORT, 'session attendance is append-only'); END;
CREATE TRIGGER session_attendance_no_delete BEFORE DELETE ON session_attendance
BEGIN SELECT RAISE(ABORT, 'session attendance is append-only'); END;
CREATE TRIGGER session_attendance_no_replace BEFORE INSERT ON session_attendance
WHEN EXISTS (SELECT 1 FROM session_attendance WHERE id = NEW.id)
  OR (NEW.corrects_id IS NULL AND EXISTS (SELECT 1 FROM session_attendance WHERE booking_id = NEW.booking_id AND corrects_id IS NULL))
  OR (NEW.corrects_id IS NOT NULL AND EXISTS (SELECT 1 FROM session_attendance WHERE corrects_id = NEW.corrects_id))
BEGIN SELECT RAISE(ABORT, 'session attendance already has a verified result or correction'); END;

CREATE TABLE session_booking_feedback (
  booking_id TEXT PRIMARY KEY NOT NULL REFERENCES session_bookings (id),
  stars INTEGER NOT NULL CHECK (typeof(stars) = 'integer' AND stars BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR (length(comment) <= 16000 AND length(trim(comment)) > 0)),
  submitted_at INTEGER NOT NULL CHECK (typeof(submitted_at) = 'integer')
);
CREATE TRIGGER session_booking_feedback_eligible BEFORE INSERT ON session_booking_feedback
WHEN NOT EXISTS (
  SELECT 1 FROM session_bookings AS booking JOIN session_slots AS slot ON slot.id = booking.slot_id
  WHERE booking.id = NEW.booking_id AND booking.state IN ('booked', 'completed') AND booking.booked_at <= NEW.submitted_at
    AND (slot.ends_at <= NEW.submitted_at OR (slot.state = 'finished' AND slot.stage_at <= NEW.submitted_at)
      OR EXISTS (SELECT 1 FROM session_attendance result
        WHERE result.booking_id = booking.id AND result.recorded_at <= NEW.submitted_at))
) OR EXISTS (SELECT 1 FROM session_booking_feedback prior WHERE prior.booking_id = NEW.booking_id)
BEGIN SELECT RAISE(ABORT, 'session feedback requires an eligible booking without prior feedback'); END;

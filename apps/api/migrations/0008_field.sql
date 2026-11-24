CREATE TABLE attendance_events (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES assignments (id),
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  actual_at INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  review_state TEXT NOT NULL,
  corrects_id TEXT,
  reason_code TEXT,
  CONSTRAINT attendance_events_kind CHECK (kind IN ('arrival', 'departure')),
  CONSTRAINT attendance_events_source CHECK (source IN ('self', 'assisted', 'manual')),
  CONSTRAINT attendance_events_times CHECK (
    typeof(actual_at) = 'integer' AND typeof(captured_at) = 'integer' AND typeof(received_at) = 'integer'
  ),
  CONSTRAINT attendance_events_state CHECK (review_state IN ('accepted', 'needs_review')),
  -- Two minutes of device clock skew; historical/offline captures have no minimum against receipt.
  CONSTRAINT attendance_events_received_time CHECK (
    review_state <> 'accepted' OR max(actual_at, captured_at) <= received_at + 120000
  ),
  CONSTRAINT attendance_events_reason CHECK (
    reason_code IN ('out_of_window', 'duplicate_event', 'missing_arrival', 'out_of_order', 'disputed', 'correction') OR reason_code IS NULL
  ),
  UNIQUE (assignment_id, id),
  FOREIGN KEY (assignment_id, corrects_id) REFERENCES attendance_events (assignment_id, id)
);
CREATE UNIQUE INDEX attendance_events_one_original ON attendance_events (assignment_id, kind)
  WHERE review_state = 'accepted' AND corrects_id IS NULL;
CREATE UNIQUE INDEX attendance_events_accepted_successor ON attendance_events (corrects_id)
  WHERE review_state = 'accepted' AND corrects_id IS NOT NULL;
CREATE INDEX attendance_events_assignment_time ON attendance_events (assignment_id, actual_at, id);
CREATE INDEX attendance_events_corrects ON attendance_events (assignment_id, corrects_id) WHERE corrects_id IS NOT NULL;

-- The command classifies an attempt with attendanceReviewState and saves disputed or
-- conflicting attempts as needs_review. These guards protect accepted receipts, even
-- across concurrent or delayed writes. A human resolution appends an attributed
-- correction: it may change a time outside the normal window, never invert the pair.
CREATE TRIGGER attendance_events_guard BEFORE INSERT ON attendance_events
BEGIN
  SELECT RAISE(ABORT, 'attendance events are append-only')
    WHERE EXISTS (SELECT 1 FROM attendance_events WHERE id = NEW.id);
  SELECT RAISE(ABORT, 'attendance correction must target a prior event of the same kind and assignment')
    WHERE NEW.corrects_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM attendance_events WHERE id = NEW.corrects_id AND assignment_id = NEW.assignment_id AND kind = NEW.kind
    );
  SELECT RAISE(ABORT, 'attendance already has an accepted event of this kind')
    WHERE NEW.review_state = 'accepted' AND EXISTS (
      SELECT 1 FROM attendance_events AS prior
      WHERE prior.assignment_id = NEW.assignment_id AND prior.kind = NEW.kind AND prior.review_state = 'accepted'
        AND prior.id IS NOT NEW.corrects_id
        AND NOT EXISTS (SELECT 1 FROM attendance_events WHERE corrects_id = prior.id AND review_state = 'accepted')
    );
  SELECT RAISE(ABORT, 'accepted departure requires an accepted arrival at or before it')
    WHERE NEW.review_state = 'accepted' AND NEW.kind = 'departure' AND NOT EXISTS (
      SELECT 1 FROM attendance_events AS arrival
      WHERE arrival.assignment_id = NEW.assignment_id AND arrival.kind = 'arrival' AND arrival.review_state = 'accepted'
        AND arrival.actual_at <= NEW.actual_at
        AND NOT EXISTS (SELECT 1 FROM attendance_events WHERE corrects_id = arrival.id AND review_state = 'accepted')
    );
  SELECT RAISE(ABORT, 'accepted arrival cannot follow its accepted departure')
    WHERE NEW.review_state = 'accepted' AND NEW.kind = 'arrival' AND EXISTS (
      SELECT 1 FROM attendance_events AS departure
      WHERE departure.assignment_id = NEW.assignment_id AND departure.kind = 'departure' AND departure.review_state = 'accepted'
        AND departure.actual_at < NEW.actual_at
        AND NOT EXISTS (SELECT 1 FROM attendance_events WHERE corrects_id = departure.id AND review_state = 'accepted')
    );
  -- UTC millisecond limits mirror ATTENDANCE_REVIEW_POLICY in the domain package.
  SELECT RAISE(ABORT, 'out-of-window attendance needs review')
    WHERE NEW.review_state = 'accepted' AND NEW.corrects_id IS NULL AND EXISTS (
      SELECT 1 FROM assignments WHERE id = NEW.assignment_id AND (
        (NEW.kind = 'arrival' AND NEW.actual_at NOT BETWEEN starts_at - 1800000 AND starts_at + 3600000)
        OR (NEW.kind = 'departure' AND NEW.actual_at > ends_at + 7200000)
      )
    );
END;
CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON attendance_events
BEGIN SELECT RAISE(ABORT, 'attendance events are append-only'); END;

CREATE TABLE attendance_correction_requests (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL,
  attendance_event_id TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES accounts (id),
  reason_code TEXT NOT NULL,
  proposed_actual_at INTEGER,
  requested_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  decided_by TEXT REFERENCES accounts (id),
  decided_at INTEGER,
  correction_event_id TEXT,
  CONSTRAINT attendance_correction_requests_reason CHECK (reason_code IN ('wrong_time', 'disputed')),
  CONSTRAINT attendance_correction_requests_times CHECK (
    typeof(requested_at) = 'integer'
    AND (proposed_actual_at IS NULL OR typeof(proposed_actual_at) = 'integer')
    AND (reason_code <> 'wrong_time' OR proposed_actual_at IS NOT NULL)
  ),
  CONSTRAINT attendance_correction_requests_state CHECK (state IN ('requested', 'accepted', 'declined', 'withdrawn')),
  CONSTRAINT attendance_correction_requests_decision CHECK (
    (state = 'requested' AND decided_by IS NULL AND decided_at IS NULL
      OR state <> 'requested' AND decided_by IS NOT NULL AND typeof(decided_at) = 'integer' AND decided_at >= requested_at)
    AND (state = 'accepted') = (correction_event_id IS NOT NULL)
    AND (correction_event_id IS NULL OR correction_event_id <> attendance_event_id)
  ),
  FOREIGN KEY (assignment_id, attendance_event_id) REFERENCES attendance_events (assignment_id, id),
  FOREIGN KEY (assignment_id, correction_event_id) REFERENCES attendance_events (assignment_id, id)
);
CREATE INDEX attendance_correction_requests_event ON attendance_correction_requests (assignment_id, attendance_event_id, state, id);
CREATE INDEX attendance_correction_requests_requester ON attendance_correction_requests (requester_id, state, requested_at, id);
CREATE INDEX attendance_correction_requests_correction ON attendance_correction_requests (assignment_id, correction_event_id)
  WHERE correction_event_id IS NOT NULL;

CREATE TABLE customer_updates (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits (id),
  actor_id TEXT REFERENCES accounts (id),
  kind TEXT NOT NULL,
  booked_window_id TEXT,
  band_start INTEGER,
  band_end INTEGER,
  next_update_at INTEGER,
  corrects_id TEXT,
  caption TEXT,
  caption_language TEXT,
  occurred_at INTEGER,
  recorded_at INTEGER NOT NULL,
  CONSTRAINT customer_updates_kind CHECK (kind IN (
    'crew_confirmed', 'on_the_way', 'arrival_revised', 'arrival_withdrawn', 'on_site', 'working',
    'paused', 'photo', 'cover_arranging', 'no_crew_available', 'crew_updated', 'finished'
  )),
  -- The first accepted arrival emits an anonymous crew-level stamp in the same
  -- batch. Later arrivals never publish another stamp or identify who checked in.
  CONSTRAINT customer_updates_attribution CHECK (
    (kind = 'on_site' AND actor_id IS NULL AND typeof(occurred_at) = 'integer')
    OR (kind <> 'on_site' AND actor_id IS NOT NULL AND occurred_at IS NULL)
  ),
  CONSTRAINT customer_updates_times CHECK (
    typeof(recorded_at) = 'integer'
    AND (next_update_at IS NULL OR (kind IN ('paused', 'cover_arranging') AND typeof(next_update_at) = 'integer'))
    AND (
      kind IN ('on_the_way', 'arrival_revised') AND typeof(band_start) = 'integer' AND typeof(band_end) = 'integer' AND band_start < band_end
      OR kind NOT IN ('on_the_way', 'arrival_revised') AND band_start IS NULL AND band_end IS NULL
    )
  ),
  CONSTRAINT customer_updates_correction CHECK ((kind IN ('arrival_revised', 'arrival_withdrawn')) = (corrects_id IS NOT NULL)),
  CONSTRAINT customer_updates_booked_window CHECK ((kind = 'no_crew_available') = (booked_window_id IS NOT NULL)),
  CONSTRAINT customer_updates_caption CHECK (
    (caption IS NULL AND caption_language IS NULL)
    OR (kind = 'photo' AND caption IS NOT NULL AND caption_language IS NOT NULL)
  ),
  UNIQUE (visit_id, id),
  FOREIGN KEY (visit_id, corrects_id) REFERENCES customer_updates (visit_id, id),
  FOREIGN KEY (visit_id, booked_window_id) REFERENCES visit_windows (visit_id, id)
);
CREATE INDEX customer_updates_visit_time ON customer_updates (visit_id, recorded_at, id);
CREATE UNIQUE INDEX customer_updates_one_on_site ON customer_updates (visit_id) WHERE kind = 'on_site';
CREATE UNIQUE INDEX customer_updates_one_successor ON customer_updates (visit_id, corrects_id) WHERE corrects_id IS NOT NULL;
CREATE TRIGGER customer_updates_guard BEFORE INSERT ON customer_updates
BEGIN
  SELECT RAISE(ABORT, 'customer updates are append-only') WHERE EXISTS (
    SELECT 1 FROM customer_updates WHERE id = NEW.id OR (visit_id = NEW.visit_id AND kind = 'on_site' AND NEW.kind = 'on_site')
  );
  SELECT RAISE(ABORT, 'customer correction requires a current arrival stamp on this visit')
    WHERE NEW.corrects_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM customer_updates AS prior
      WHERE prior.id = NEW.corrects_id AND prior.visit_id = NEW.visit_id AND prior.kind IN ('on_the_way', 'arrival_revised')
        AND prior.recorded_at <= NEW.recorded_at
        AND NOT EXISTS (SELECT 1 FROM customer_updates WHERE visit_id = prior.visit_id AND corrects_id = prior.id)
    );
END;
CREATE TRIGGER customer_updates_no_update BEFORE UPDATE ON customer_updates
BEGIN SELECT RAISE(ABORT, 'customer updates are append-only'); END;

CREATE TABLE visit_activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL REFERENCES visits (id),
  assignment_id TEXT REFERENCES assignments (id),
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  captured_at INTEGER,
  band_start INTEGER,
  band_end INTEGER,
  safe_detail TEXT,
  detail_language TEXT,
  customer_update_id TEXT,
  CONSTRAINT visit_activity_events_kind CHECK (
    kind IN ('setting_off', 'work_started', 'work_paused', 'work_finished', 'progress_photo', 'arrival_plan_set')
  ),
  CONSTRAINT visit_activity_events_times CHECK (
    typeof(at) = 'integer' AND (
      kind = 'setting_off' AND typeof(band_start) = 'integer' AND typeof(band_end) = 'integer' AND band_start < band_end
      OR kind <> 'setting_off' AND band_start IS NULL AND band_end IS NULL
    )
  ),
  CONSTRAINT visit_activity_events_capture CHECK (
    (kind = 'progress_photo' AND typeof(captured_at) = 'integer') OR (kind <> 'progress_photo' AND captured_at IS NULL)
  ),
  CONSTRAINT visit_activity_events_assignment CHECK (kind NOT IN ('setting_off', 'progress_photo') OR assignment_id IS NOT NULL),
  CONSTRAINT visit_activity_events_detail_language CHECK (
    (detail_language IS NULL OR safe_detail IS NOT NULL)
    AND (kind <> 'arrival_plan_set' OR (safe_detail IS NOT NULL AND detail_language IS NOT NULL))
  ),
  FOREIGN KEY (visit_id, customer_update_id) REFERENCES customer_updates (visit_id, id)
);
CREATE INDEX visit_activity_events_visit_time ON visit_activity_events (visit_id, at, id);
CREATE INDEX visit_activity_events_assignment_time ON visit_activity_events (assignment_id, at, id) WHERE assignment_id IS NOT NULL;
CREATE INDEX visit_activity_events_customer_update ON visit_activity_events (visit_id, customer_update_id) WHERE customer_update_id IS NOT NULL;
CREATE TRIGGER visit_activity_events_guard BEFORE INSERT ON visit_activity_events
BEGIN
  SELECT RAISE(ABORT, 'visit activity is append-only') WHERE EXISTS (SELECT 1 FROM visit_activity_events WHERE id = NEW.id);
  SELECT RAISE(ABORT, 'visit activity assignment must belong to the visit')
    WHERE NEW.assignment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM assignments AS a JOIN shift_slots AS slot ON slot.id = a.slot_id JOIN shifts AS s ON s.id = slot.shift_id
      WHERE a.id = NEW.assignment_id AND s.visit_id = NEW.visit_id
    );
END;
CREATE TRIGGER visit_activity_events_no_update BEFORE UPDATE ON visit_activity_events
BEGIN SELECT RAISE(ABORT, 'visit activity is append-only'); END;

CREATE TABLE safety_instructions (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments (id)
);
CREATE INDEX safety_instructions_job ON safety_instructions (job_id, id);
CREATE TRIGGER safety_instructions_guard BEFORE INSERT ON safety_instructions
WHEN EXISTS (SELECT 1 FROM safety_instructions WHERE id = NEW.id OR assignment_id = NEW.assignment_id) OR NOT EXISTS (
  SELECT 1 FROM assignments AS a JOIN shift_slots AS slot ON slot.id = a.slot_id
  JOIN shifts AS s ON s.id = slot.shift_id JOIN visits AS v ON v.id = s.visit_id
  WHERE a.id = NEW.assignment_id AND v.job_id = NEW.job_id
)
BEGIN SELECT RAISE(ABORT, 'safety instruction must belong to its assigned job and worker'); END;
CREATE TRIGGER safety_instructions_no_update BEFORE UPDATE ON safety_instructions
BEGIN SELECT RAISE(ABORT, 'safety instruction scope is immutable'); END;

CREATE TABLE safety_versions (
  id TEXT PRIMARY KEY NOT NULL,
  instruction_id TEXT NOT NULL REFERENCES safety_instructions (id),
  no INTEGER NOT NULL,
  issuer_id TEXT NOT NULL REFERENCES accounts (id),
  original TEXT NOT NULL,
  language TEXT NOT NULL,
  reviewed_human_reading_aid TEXT,
  reading_aid_language TEXT,
  issued_at INTEGER NOT NULL,
  CONSTRAINT safety_versions_order CHECK (typeof(no) = 'integer' AND no > 0 AND typeof(issued_at) = 'integer'),
  CONSTRAINT safety_versions_reading_aid CHECK ((reviewed_human_reading_aid IS NULL) = (reading_aid_language IS NULL)),
  UNIQUE (instruction_id, no)
);
CREATE TRIGGER safety_versions_guard BEFORE INSERT ON safety_versions
WHEN EXISTS (
  SELECT 1 FROM safety_versions
  WHERE id = NEW.id OR (instruction_id = NEW.instruction_id AND (no >= NEW.no OR issued_at > NEW.issued_at))
)
BEGIN SELECT RAISE(ABORT, 'safety instruction versions must advance'); END;
CREATE TRIGGER safety_versions_no_update BEFORE UPDATE ON safety_versions
BEGIN SELECT RAISE(ABORT, 'safety instruction versions are append-only'); END;

CREATE TABLE teach_backs (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL REFERENCES safety_versions (id),
  assignment_id TEXT NOT NULL REFERENCES assignments (id),
  verified_by TEXT NOT NULL REFERENCES accounts (id),
  language TEXT NOT NULL,
  interpreter_ref TEXT,
  checklist TEXT NOT NULL,
  outcome TEXT NOT NULL,
  at INTEGER NOT NULL,
  CONSTRAINT teach_backs_outcome CHECK (outcome IN ('passed', 'not_understood')),
  CONSTRAINT teach_backs_time CHECK (typeof(at) = 'integer'),
  CONSTRAINT teach_backs_checklist CHECK (CASE WHEN json_valid(checklist) THEN
    COALESCE(json_type(checklist, '$.hazard') IN ('true', 'false')
      AND json_type(checklist, '$.control') IN ('true', 'false')
      AND json_type(checklist, '$.response') IN ('true', 'false')
      AND (outcome <> 'passed' OR (
        json_extract(checklist, '$.hazard') = 1 AND json_extract(checklist, '$.control') = 1 AND json_extract(checklist, '$.response') = 1
      )), 0) ELSE 0 END),
  UNIQUE (version_id, assignment_id, id)
);
CREATE INDEX teach_backs_latest ON teach_backs (version_id, assignment_id, at, id);
CREATE INDEX teach_backs_assignment ON teach_backs (assignment_id, at, id);

CREATE TABLE safety_acknowledgements (
  version_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  worker_id TEXT NOT NULL REFERENCES accounts (id),
  teach_back_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  CONSTRAINT safety_acknowledgements_time CHECK (typeof(at) = 'integer'),
  PRIMARY KEY (version_id, assignment_id),
  FOREIGN KEY (version_id, assignment_id, teach_back_id) REFERENCES teach_backs (version_id, assignment_id, id)
);
CREATE INDEX safety_acknowledgements_assignment ON safety_acknowledgements (assignment_id, at, version_id);
CREATE TRIGGER teach_backs_guard BEFORE INSERT ON teach_backs
WHEN EXISTS (SELECT 1 FROM teach_backs WHERE id = NEW.id)
  OR EXISTS (SELECT 1 FROM safety_acknowledgements WHERE version_id = NEW.version_id AND assignment_id = NEW.assignment_id)
  OR NOT EXISTS (
    SELECT 1 FROM safety_versions AS v JOIN safety_instructions AS i ON i.id = v.instruction_id
    WHERE v.id = NEW.version_id AND i.assignment_id = NEW.assignment_id AND v.issuer_id = NEW.verified_by
      AND v.issued_at <= NEW.at
      AND NOT EXISTS (SELECT 1 FROM safety_versions WHERE instruction_id = i.id AND no > v.no)
  )
BEGIN SELECT RAISE(ABORT, 'teach-back must be for the current unacknowledged version with its issuer'); END;
CREATE TRIGGER teach_backs_no_update BEFORE UPDATE ON teach_backs
BEGIN SELECT RAISE(ABORT, 'teach-backs are append-only'); END;
CREATE TRIGGER safety_acknowledgements_guard BEFORE INSERT ON safety_acknowledgements
WHEN EXISTS (SELECT 1 FROM safety_acknowledgements WHERE version_id = NEW.version_id AND assignment_id = NEW.assignment_id) OR NOT EXISTS (
  SELECT 1 FROM teach_backs AS proof
  JOIN safety_versions AS v ON v.id = proof.version_id JOIN safety_instructions AS i ON i.id = v.instruction_id
  JOIN assignments AS a ON a.id = i.assignment_id JOIN memberships AS worker ON worker.id = a.worker_membership_id
  WHERE proof.id = NEW.teach_back_id AND proof.version_id = NEW.version_id AND i.assignment_id = NEW.assignment_id
    AND worker.account_id = NEW.worker_id AND proof.outcome = 'passed' AND proof.at <= NEW.at
    AND NOT EXISTS (SELECT 1 FROM safety_versions WHERE instruction_id = i.id AND no > v.no)
    AND NOT EXISTS (
      SELECT 1 FROM teach_backs
      WHERE version_id = proof.version_id AND assignment_id = proof.assignment_id AND (at, id) > (proof.at, proof.id)
    )
)
BEGIN SELECT RAISE(ABORT, 'worker acknowledgement requires the current positive teach-back'); END;
CREATE TRIGGER safety_acknowledgements_no_update BEFORE UPDATE ON safety_acknowledgements
BEGIN SELECT RAISE(ABORT, 'safety acknowledgements are append-only'); END;

CREATE TABLE safety_holds (
  id TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES assignments (id),
  version_id TEXT REFERENCES safety_versions (id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  cleared_at INTEGER,
  CONSTRAINT safety_holds_kind CHECK (kind IN ('briefing', 'work_rule', 'incident')),
  CONSTRAINT safety_holds_state CHECK (state IN ('active', 'cleared')),
  CONSTRAINT safety_holds_clearance CHECK (
    (state = 'active' AND cleared_at IS NULL) OR (state = 'cleared' AND typeof(cleared_at) = 'integer')
  )
);
CREATE INDEX safety_holds_assignment ON safety_holds (assignment_id, id);
CREATE INDEX safety_holds_version ON safety_holds (version_id) WHERE version_id IS NOT NULL;
CREATE INDEX safety_holds_active ON safety_holds (assignment_id, kind, version_id, id) WHERE state = 'active';
CREATE TRIGGER safety_holds_guard BEFORE INSERT ON safety_holds
WHEN NEW.state <> 'active' OR EXISTS (SELECT 1 FROM safety_holds WHERE id = NEW.id) OR (
  NEW.version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM safety_versions AS v JOIN safety_instructions AS i ON i.id = v.instruction_id
    WHERE v.id = NEW.version_id AND i.assignment_id = NEW.assignment_id
  )
)
BEGIN SELECT RAISE(ABORT, 'safety holds start active and belong to their assigned worker'); END;
-- Only the current version's briefing hold blocks work (or a versionless
-- briefing hold before first issue). Older versions stay in history without
-- manufacturing a clearance. Other active holds remain independent.
CREATE TRIGGER safety_holds_clear BEFORE UPDATE ON safety_holds
WHEN OLD.state <> 'active' OR NEW.state <> 'cleared' OR NEW.id IS NOT OLD.id
  OR NEW.assignment_id IS NOT OLD.assignment_id OR NEW.version_id IS NOT OLD.version_id OR NEW.kind IS NOT OLD.kind
  OR (OLD.kind = 'briefing' AND NOT EXISTS (
    SELECT 1 FROM safety_acknowledgements WHERE version_id = OLD.version_id AND assignment_id = OLD.assignment_id AND at <= NEW.cleared_at
  ))
BEGIN SELECT RAISE(ABORT, 'briefing clearance requires that version’s worker acknowledgement'); END;
CREATE TRIGGER safety_holds_no_delete_active BEFORE DELETE ON safety_holds
WHEN OLD.state = 'active'
BEGIN SELECT RAISE(ABORT, 'active safety holds must be cleared before disposal'); END;

CREATE TABLE safety_questions (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL REFERENCES safety_versions (id),
  worker_id TEXT NOT NULL REFERENCES accounts (id),
  original TEXT NOT NULL,
  language TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  CONSTRAINT safety_questions_time CHECK (typeof(asked_at) = 'integer')
);
CREATE INDEX safety_questions_version_time ON safety_questions (version_id, asked_at, id);
CREATE TRIGGER safety_questions_guard BEFORE INSERT ON safety_questions
WHEN EXISTS (SELECT 1 FROM safety_questions WHERE id = NEW.id) OR NOT EXISTS (
  SELECT 1 FROM safety_versions AS v JOIN safety_instructions AS i ON i.id = v.instruction_id
  JOIN assignments AS a ON a.id = i.assignment_id JOIN memberships AS worker ON worker.id = a.worker_membership_id
  WHERE v.id = NEW.version_id AND worker.account_id = NEW.worker_id AND v.issued_at <= NEW.asked_at
    AND NOT EXISTS (SELECT 1 FROM safety_versions WHERE instruction_id = i.id AND no > v.no)
)
BEGIN SELECT RAISE(ABORT, 'safety questions belong to the current version and named worker'); END;
CREATE TRIGGER safety_questions_no_update BEFORE UPDATE ON safety_questions
BEGIN SELECT RAISE(ABORT, 'safety questions are append-only'); END;

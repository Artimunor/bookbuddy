-- A caller's guarded command resolves parent_scope_id. It may be a draft ID
-- before the object is linked, so it is not an access grant or a parent FK.
CREATE TABLE media_stages (
  id TEXT PRIMARY KEY NOT NULL,
  context_id TEXT NOT NULL REFERENCES account_contexts (id),
  caller TEXT NOT NULL CONSTRAINT media_stages_caller CHECK (caller IN ('request', 'chat', 'progress', 'update', 'quote', 'change', 'completion', 'case')),
  parent_scope_id TEXT NOT NULL,
  created_at INTEGER NOT NULL CONSTRAINT media_stages_created_at CHECK (typeof(created_at) = 'integer'),
  expires_at INTEGER NOT NULL CONSTRAINT media_stages_expires_at CHECK (typeof(expires_at) = 'integer' AND expires_at > created_at)
);
CREATE INDEX media_stages_scope ON media_stages (context_id, caller, parent_scope_id, expires_at, id);
CREATE INDEX media_stages_due ON media_stages (expires_at, id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL,
  stage_id TEXT NOT NULL REFERENCES media_stages (id),
  object_key TEXT NOT NULL UNIQUE,
  upload_generation INTEGER NOT NULL DEFAULT 1 CONSTRAINT attachments_generation CHECK (typeof(upload_generation) = 'integer' AND upload_generation >= 1),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CONSTRAINT attachments_bytes CHECK (typeof(bytes) = 'integer' AND bytes > 0),
  duration_ms INTEGER CONSTRAINT attachments_duration CHECK (duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms > 0)),
  r2_upload_id TEXT,
  state TEXT NOT NULL CONSTRAINT attachments_state CHECK (state IN ('reserved', 'preparing', 'uploading', 'verifying', 'ready', 'rejected', 'expired')),
  lease_until INTEGER CONSTRAINT attachments_lease CHECK (
    lease_until IS NULL OR (typeof(lease_until) = 'integer' AND state IN ('preparing', 'verifying'))
  ),
  etag TEXT,
  retention_class TEXT NOT NULL CONSTRAINT attachments_retention_class CHECK (retention_class IN ('unlinked', 'progress', 'ordinary', 'decision', 'case', 'safety')),
  delete_after INTEGER CONSTRAINT attachments_delete_after CHECK (delete_after IS NULL OR typeof(delete_after) = 'integer'),
  CONSTRAINT attachments_ready CHECK (state <> 'ready' OR (etag IS NOT NULL AND length(etag) > 0))
);
CREATE INDEX attachments_stage_state ON attachments (stage_id, state, id);
CREATE INDEX attachments_due ON attachments (delete_after, id) WHERE delete_after IS NOT NULL;

-- A definitively absent upload may leave verification and resume the same
-- reservation. Settled bytes cannot be replaced when renewing grants or sharing.
CREATE TRIGGER attachments_transition BEFORE UPDATE ON attachments
WHEN (NEW.state <> OLD.state AND NOT (
  (OLD.state = 'reserved' AND NEW.state IN ('preparing', 'uploading', 'rejected', 'expired'))
  OR (OLD.state = 'preparing' AND NEW.state IN ('uploading', 'rejected', 'expired'))
  OR (OLD.state = 'uploading' AND NEW.state IN ('verifying', 'rejected', 'expired'))
  OR (OLD.state = 'verifying' AND NEW.state IN ('uploading', 'ready', 'rejected', 'expired'))
  OR (OLD.state IN ('ready', 'rejected') AND NEW.state = 'expired')
)) OR NEW.id IS NOT OLD.id OR NEW.stage_id IS NOT OLD.stage_id
  OR (OLD.state IN ('ready', 'expired') AND (
    NEW.object_key IS NOT OLD.object_key OR NEW.upload_generation IS NOT OLD.upload_generation
    OR NEW.mime IS NOT OLD.mime OR NEW.bytes IS NOT OLD.bytes OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.etag IS NOT OLD.etag
  ))
BEGIN SELECT RAISE(ABORT, 'attachment state transition or settled object change is invalid'); END;

-- Links are separate authorizations to the same object, not copies or grants
-- to the original parent. Commands check ready state and authority at linking.
CREATE TABLE request_attachments (
  job_id TEXT NOT NULL REFERENCES requests (job_id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (job_id, attachment_id)
);
CREATE INDEX request_attachments_attachment ON request_attachments (attachment_id);

CREATE TABLE entry_attachments (
  entry_id TEXT NOT NULL REFERENCES chat_entries (id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (entry_id, attachment_id)
);
CREATE INDEX entry_attachments_attachment ON entry_attachments (attachment_id);

CREATE TABLE shift_evidence (
  shift_id TEXT NOT NULL REFERENCES shifts (id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  activity_event_id TEXT NOT NULL UNIQUE REFERENCES visit_activity_events (id),
  PRIMARY KEY (shift_id, attachment_id)
);
CREATE INDEX shift_evidence_attachment ON shift_evidence (attachment_id);
CREATE TRIGGER shift_evidence_progress BEFORE INSERT ON shift_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM visit_activity_events AS event
  JOIN assignments AS a ON a.id = event.assignment_id
  JOIN shift_slots AS slot ON slot.id = a.slot_id
  WHERE event.id = NEW.activity_event_id AND event.kind = 'progress_photo' AND slot.shift_id = NEW.shift_id
)
BEGIN SELECT RAISE(ABORT, 'progress evidence requires an activity event from its shift'); END;
CREATE TRIGGER shift_evidence_immutable BEFORE UPDATE ON shift_evidence
BEGIN SELECT RAISE(ABORT, 'progress evidence links are immutable'); END;

CREATE TABLE update_attachments (
  update_id TEXT NOT NULL REFERENCES customer_updates (id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (update_id, attachment_id)
);
CREATE INDEX update_attachments_attachment ON update_attachments (attachment_id);

CREATE TABLE quote_attachments (
  quote_version_id TEXT NOT NULL REFERENCES quote_versions (id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (quote_version_id, attachment_id)
);
CREATE INDEX quote_attachments_attachment ON quote_attachments (attachment_id);

CREATE TABLE change_attachments (
  change_version_id TEXT NOT NULL REFERENCES change_versions (id),
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (change_version_id, attachment_id)
);
CREATE INDEX change_attachments_attachment ON change_attachments (attachment_id);

CREATE TABLE completion_attachments (
  completion_id TEXT NOT NULL,
  completion_item_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  caption TEXT,
  caption_language TEXT,
  CONSTRAINT completion_attachments_caption CHECK ((caption IS NULL) = (caption_language IS NULL)
    AND (caption IS NULL OR length(trim(caption, char(9, 10, 11, 12, 13, 32))) > 0)),
  PRIMARY KEY (completion_id, completion_item_id, attachment_id),
  FOREIGN KEY (completion_item_id, completion_id) REFERENCES completion_items (id, completion_id)
);
CREATE INDEX completion_attachments_attachment ON completion_attachments (attachment_id);

CREATE TABLE case_attachments (
  case_id TEXT NOT NULL,
  case_event_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES attachments (id),
  PRIMARY KEY (case_id, case_event_id, attachment_id),
  FOREIGN KEY (case_event_id, case_id) REFERENCES case_events (id, case_id)
);
CREATE INDEX case_attachments_attachment ON case_attachments (attachment_id);

CREATE TABLE retention_holds (
  id TEXT PRIMARY KEY NOT NULL,
  record_kind TEXT NOT NULL CONSTRAINT retention_holds_record_kind CHECK (length(record_kind) > 0),
  record_id TEXT NOT NULL CONSTRAINT retention_holds_record_id CHECK (length(record_id) > 0),
  reason TEXT NOT NULL CONSTRAINT retention_holds_reason CHECK (length(trim(reason)) > 0),
  review_at INTEGER NOT NULL CONSTRAINT retention_holds_review_at CHECK (typeof(review_at) = 'integer'),
  released_at INTEGER CONSTRAINT retention_holds_released_at CHECK (released_at IS NULL OR typeof(released_at) = 'integer')
);
CREATE INDEX retention_holds_record ON retention_holds (record_kind, record_id) WHERE released_at IS NULL;
CREATE INDEX retention_holds_review ON retention_holds (review_at, id) WHERE released_at IS NULL;

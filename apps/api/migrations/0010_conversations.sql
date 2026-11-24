CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT REFERENCES jobs (id),
  -- The greenfield session schema creates this referenced table in 0012,
  -- before the API or seed inserts chat threads.
  session_booking_id TEXT REFERENCES session_bookings (id),
  audience TEXT NOT NULL CONSTRAINT chat_threads_audience CHECK (audience IN ('job', 'crew', 'session')),
  write_state TEXT NOT NULL CONSTRAINT chat_threads_write_state CHECK (write_state IN ('open', 'read_only')),
  last_position INTEGER NOT NULL DEFAULT 0 CONSTRAINT chat_threads_last_position CHECK (typeof(last_position) = 'integer' AND last_position >= 0),
  CONSTRAINT chat_threads_parent CHECK (
    (audience = 'session' AND session_booking_id IS NOT NULL AND job_id IS NULL)
    OR (audience IN ('job', 'crew') AND job_id IS NOT NULL AND session_booking_id IS NULL)),
  UNIQUE (job_id, audience),
  UNIQUE (session_booking_id)
);

-- visible_from is the first position the context may read, inclusive. A row is
-- not authority on its own: commands and projections recheck the live audience.
CREATE TABLE chat_members (
  thread_id TEXT NOT NULL REFERENCES chat_threads (id),
  context_id TEXT NOT NULL REFERENCES account_contexts (id),
  can_send INTEGER NOT NULL CONSTRAINT chat_members_can_send CHECK (can_send IN (0, 1)),
  visible_from INTEGER NOT NULL CONSTRAINT chat_members_visible_from CHECK (typeof(visible_from) = 'integer' AND visible_from >= 1),
  revoked_at INTEGER CONSTRAINT chat_members_revoked_at CHECK (revoked_at IS NULL OR typeof(revoked_at) = 'integer'),
  PRIMARY KEY (thread_id, context_id)
);
CREATE INDEX chat_members_scope ON chat_members (context_id, revoked_at, thread_id);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  author_context_id TEXT NOT NULL,
  FOREIGN KEY (thread_id, author_context_id) REFERENCES chat_members (thread_id, context_id),
  UNIQUE (id, thread_id)
);
CREATE INDEX chat_messages_author ON chat_messages (thread_id, author_context_id);

CREATE TABLE chat_entries (
  id TEXT PRIMARY KEY NOT NULL,
  root_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  revision INTEGER NOT NULL CONSTRAINT chat_entries_revision CHECK (typeof(revision) = 'integer' AND revision >= 1),
  position INTEGER NOT NULL CONSTRAINT chat_entries_position CHECK (typeof(position) = 'integer' AND position >= 1),
  corrects_id TEXT,
  source_language TEXT,
  original_text TEXT CONSTRAINT chat_entries_original CHECK (
    original_text IS NULL OR length(trim(original_text, char(9, 10, 11, 12, 13, 32))) > 0
  ),
  received_at INTEGER NOT NULL CONSTRAINT chat_entries_received_at CHECK (typeof(received_at) = 'integer'),
  CONSTRAINT chat_entries_correction CHECK ((revision = 1) = (corrects_id IS NULL) AND (corrects_id IS NULL OR corrects_id <> id)),
  FOREIGN KEY (root_id, thread_id) REFERENCES chat_messages (id, thread_id),
  FOREIGN KEY (corrects_id, root_id) REFERENCES chat_entries (id, root_id),
  UNIQUE (id, root_id),
  UNIQUE (root_id, revision),
  UNIQUE (thread_id, position)
);
CREATE INDEX chat_entries_corrects ON chat_entries (corrects_id, root_id) WHERE corrects_id IS NOT NULL;

-- The scoped append command advances last_position and links ready attachments
-- in the same batch. An entry with no text must have an original attachment.
CREATE TRIGGER chat_entries_previous_revision BEFORE INSERT ON chat_entries
WHEN NEW.corrects_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chat_entries AS prior WHERE prior.id = NEW.corrects_id AND prior.root_id = NEW.root_id
    AND prior.revision + 1 = NEW.revision AND prior.position < NEW.position
)
BEGIN SELECT RAISE(ABORT, 'correction must append after the previous revision of this message'); END;

CREATE TRIGGER chat_entries_no_replace BEFORE INSERT ON chat_entries
WHEN EXISTS (SELECT 1 FROM chat_entries WHERE id = NEW.id)
  OR EXISTS (SELECT 1 FROM chat_entries WHERE root_id = NEW.root_id AND revision = NEW.revision)
  OR EXISTS (SELECT 1 FROM chat_entries WHERE thread_id = NEW.thread_id AND position = NEW.position)
BEGIN SELECT RAISE(ABORT, 'message entries are append-only'); END;

CREATE TRIGGER chat_messages_immutable BEFORE UPDATE ON chat_messages
BEGIN SELECT RAISE(ABORT, 'message identity and attribution are immutable'); END;
CREATE TRIGGER chat_entries_immutable BEFORE UPDATE ON chat_entries
BEGIN SELECT RAISE(ABORT, 'message entries are append-only'); END;

CREATE TABLE message_translations (
  root_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  target_locale TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  state TEXT NOT NULL CONSTRAINT message_translations_state CHECK (state IN ('pending', 'ready', 'unavailable')),
  translated_text TEXT,
  provider TEXT,
  model TEXT,
  produced_at INTEGER,
  CONSTRAINT message_translations_locales CHECK (length(source_locale) > 0 AND length(target_locale) > 0 AND source_locale <> target_locale),
  CONSTRAINT message_translations_result CHECK (
    (state = 'ready' AND translated_text IS NOT NULL AND length(trim(translated_text)) > 0
      AND provider IS NOT NULL AND length(provider) > 0 AND model IS NOT NULL AND length(model) > 0 AND typeof(produced_at) = 'integer')
    OR (state <> 'ready' AND translated_text IS NULL AND produced_at IS NULL)
  ),
  PRIMARY KEY (root_id, revision, target_locale),
  FOREIGN KEY (root_id, revision) REFERENCES chat_entries (root_id, revision)
);

-- Reviewed aids are supplemental to, and pinned to, an exact commercial
-- snapshot. Safety versions already carry their reviewed human aid in 0008.
CREATE TABLE reading_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  quote_version_id TEXT REFERENCES quote_versions (id),
  change_version_id TEXT REFERENCES change_versions (id),
  target_locale TEXT NOT NULL,
  translated_text TEXT NOT NULL CONSTRAINT reading_artifacts_text CHECK (length(trim(translated_text)) > 0),
  reviewed_by_context_id TEXT NOT NULL REFERENCES account_contexts (id),
  reviewed_at INTEGER NOT NULL CONSTRAINT reading_artifacts_reviewed_at CHECK (typeof(reviewed_at) = 'integer'),
  CONSTRAINT reading_artifacts_scope CHECK ((quote_version_id IS NULL) <> (change_version_id IS NULL)),
  UNIQUE (id, quote_version_id),
  UNIQUE (id, change_version_id)
);
CREATE INDEX reading_artifacts_quote ON reading_artifacts (quote_version_id, target_locale, reviewed_at, id) WHERE quote_version_id IS NOT NULL;
CREATE INDEX reading_artifacts_change ON reading_artifacts (change_version_id, target_locale, reviewed_at, id) WHERE change_version_id IS NOT NULL;
CREATE INDEX reading_artifacts_reviewer ON reading_artifacts (reviewed_by_context_id);
CREATE TRIGGER reading_artifacts_immutable BEFORE UPDATE ON reading_artifacts
BEGIN SELECT RAISE(ABORT, 'reviewed reading aids are immutable'); END;
CREATE TRIGGER reading_artifacts_no_replace BEFORE INSERT ON reading_artifacts
WHEN EXISTS (SELECT 1 FROM reading_artifacts WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'reviewed reading aids are immutable'); END;

CREATE TABLE thread_reads (
  thread_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  position INTEGER NOT NULL CONSTRAINT thread_reads_position CHECK (typeof(position) = 'integer' AND position >= 0),
  PRIMARY KEY (thread_id, context_id),
  FOREIGN KEY (thread_id, context_id) REFERENCES chat_members (thread_id, context_id)
);
CREATE TRIGGER thread_reads_monotonic BEFORE UPDATE ON thread_reads
WHEN NEW.position < OLD.position
BEGIN SELECT RAISE(ABORT, 'read position cannot move backwards'); END;

-- Reporting checks the exact revision/target and the reader's current scope.
CREATE TABLE translation_reports (
  entry_id TEXT NOT NULL REFERENCES chat_entries (id),
  context_id TEXT NOT NULL REFERENCES account_contexts (id),
  target_locale TEXT NOT NULL,
  reported_at INTEGER NOT NULL CONSTRAINT translation_reports_reported_at CHECK (typeof(reported_at) = 'integer'),
  PRIMARY KEY (entry_id, context_id)
);
CREATE INDEX translation_reports_scope ON translation_reports (context_id, entry_id);

CREATE TABLE terms_versions (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses (id),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  provider_legal_snapshot TEXT NOT NULL,
  original_text TEXT NOT NULL,
  contract_locale TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  hash TEXT NOT NULL CHECK (length(hash) > 0),
  UNIQUE (id, business_id)
);
CREATE INDEX terms_versions_business_version ON terms_versions (business_id, version, id);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs (id),
  UNIQUE (id, job_id)
);

CREATE TABLE quote_versions (
  id TEXT PRIMARY KEY NOT NULL,
  quote_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  no INTEGER NOT NULL CHECK (typeof(no) = 'integer' AND no > 0),
  author_id TEXT NOT NULL REFERENCES accounts (id),
  publisher_id TEXT REFERENCES accounts (id),
  terms_id TEXT NOT NULL,
  original_locale TEXT NOT NULL,
  scope TEXT NOT NULL,
  exclusions TEXT NOT NULL,
  net_minor INTEGER NOT NULL CHECK (typeof(net_minor) = 'integer' AND net_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (typeof(tax_minor) = 'integer' AND tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor) = 'integer' AND total_minor > 0 AND total_minor = net_minor + tax_minor),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  issued_at INTEGER,
  expires_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('draft', 'in_review', 'returned', 'issued', 'approved', 'declined', 'superseded', 'withdrawn')),
  CONSTRAINT quote_versions_publication CHECK (
    (state IN ('draft', 'in_review', 'returned') AND publisher_id IS NULL AND issued_at IS NULL AND expires_at IS NULL)
    OR (state NOT IN ('draft', 'in_review', 'returned') AND publisher_id IS NOT NULL
        AND typeof(issued_at) = 'integer' AND typeof(expires_at) = 'integer' AND expires_at > issued_at)
  ),
  FOREIGN KEY (quote_id, job_id) REFERENCES quotes (id, job_id),
  FOREIGN KEY (job_id, business_id) REFERENCES jobs (id, business_id),
  FOREIGN KEY (terms_id, business_id) REFERENCES terms_versions (id, business_id),
  UNIQUE (quote_id, no),
  UNIQUE (id, job_id)
);
CREATE UNIQUE INDEX quote_versions_live ON quote_versions (quote_id) WHERE state IN ('issued', 'approved');
CREATE INDEX quote_versions_due ON quote_versions (expires_at, id) WHERE state = 'issued';
CREATE INDEX quote_versions_job ON quote_versions (job_id, business_id);
CREATE INDEX quote_versions_terms ON quote_versions (terms_id, business_id);

CREATE TABLE quote_items (
  version_id TEXT NOT NULL REFERENCES quote_versions (id),
  line_no INTEGER NOT NULL CHECK (typeof(line_no) = 'integer' AND line_no > 0),
  original_label TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  net_minor INTEGER NOT NULL CHECK (typeof(net_minor) = 'integer' AND net_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (typeof(tax_minor) = 'integer' AND tax_minor >= 0),
  evidence_rule TEXT NOT NULL,
  PRIMARY KEY (version_id, line_no)
);

CREATE TABLE change_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  base_quote_version_id TEXT NOT NULL,
  FOREIGN KEY (base_quote_version_id, job_id) REFERENCES quote_versions (id, job_id),
  UNIQUE (id, job_id)
);
CREATE INDEX change_proposals_job ON change_proposals (job_id, id);
CREATE INDEX change_proposals_base ON change_proposals (base_quote_version_id, job_id);

CREATE TABLE change_versions (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  no INTEGER NOT NULL CHECK (typeof(no) = 'integer' AND no > 0),
  author_id TEXT NOT NULL REFERENCES accounts (id),
  publisher_id TEXT REFERENCES accounts (id),
  terms_id TEXT NOT NULL,
  original_locale TEXT NOT NULL,
  original_text TEXT NOT NULL,
  delta_minor INTEGER NOT NULL CHECK (typeof(delta_minor) = 'integer'),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor) = 'integer' AND total_minor >= 0),
  timing TEXT NOT NULL,
  affected_items TEXT NOT NULL,
  issued_at INTEGER,
  expires_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('draft', 'in_review', 'returned', 'issued', 'approved', 'rejected', 'superseded', 'withdrawn')),
  CONSTRAINT change_versions_publication CHECK (
    (state IN ('draft', 'in_review', 'returned') AND publisher_id IS NULL AND issued_at IS NULL AND expires_at IS NULL)
    OR (state NOT IN ('draft', 'in_review', 'returned') AND publisher_id IS NOT NULL
        AND typeof(issued_at) = 'integer' AND typeof(expires_at) = 'integer'
        AND expires_at > issued_at AND expires_at - issued_at <= 259200000)
  ),
  FOREIGN KEY (proposal_id, job_id) REFERENCES change_proposals (id, job_id),
  FOREIGN KEY (job_id, business_id) REFERENCES jobs (id, business_id),
  FOREIGN KEY (terms_id, business_id) REFERENCES terms_versions (id, business_id),
  UNIQUE (proposal_id, no)
);
CREATE UNIQUE INDEX change_versions_live ON change_versions (proposal_id) WHERE state = 'issued';
CREATE INDEX change_versions_due ON change_versions (expires_at, id) WHERE state = 'issued';
CREATE INDEX change_versions_job ON change_versions (job_id, business_id);
CREATE INDEX change_versions_terms ON change_versions (terms_id, business_id);

CREATE TABLE change_items (
  version_id TEXT NOT NULL REFERENCES change_versions (id),
  line_no INTEGER NOT NULL CHECK (typeof(line_no) = 'integer' AND line_no > 0),
  original_label TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  net_minor INTEGER NOT NULL CHECK (typeof(net_minor) = 'integer'),
  tax_minor INTEGER NOT NULL CHECK (typeof(tax_minor) = 'integer'),
  evidence_rule TEXT NOT NULL,
  PRIMARY KEY (version_id, line_no)
);

CREATE TABLE commercial_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  quote_version_id TEXT REFERENCES quote_versions (id),
  change_version_id TEXT REFERENCES change_versions (id),
  reviewer_id TEXT NOT NULL REFERENCES accounts (id),
  backup_id TEXT NOT NULL REFERENCES accounts (id),
  submitted_at INTEGER NOT NULL CHECK (typeof(submitted_at) = 'integer'),
  due_at INTEGER NOT NULL CHECK (typeof(due_at) = 'integer' AND due_at > submitted_at),
  resolved_by_id TEXT REFERENCES accounts (id),
  resolved_at INTEGER,
  return_reason TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'returned', 'issued')),
  CONSTRAINT commercial_reviews_version CHECK ((quote_version_id IS NULL) <> (change_version_id IS NULL)),
  CONSTRAINT commercial_reviews_distinct CHECK (reviewer_id <> backup_id),
  CONSTRAINT commercial_reviews_resolution CHECK (
    (state = 'pending' AND resolved_by_id IS NULL AND resolved_at IS NULL AND return_reason IS NULL)
    OR (state IN ('returned', 'issued') AND resolved_by_id IS NOT NULL AND typeof(resolved_at) = 'integer' AND resolved_at >= submitted_at AND (
      (state = 'returned' AND return_reason IS NOT NULL AND length(trim(return_reason)) > 0)
      OR (state = 'issued' AND return_reason IS NULL)))
  )
);
CREATE UNIQUE INDEX commercial_reviews_quote ON commercial_reviews (quote_version_id) WHERE quote_version_id IS NOT NULL;
CREATE UNIQUE INDEX commercial_reviews_change ON commercial_reviews (change_version_id) WHERE change_version_id IS NOT NULL;
CREATE INDEX commercial_reviews_reviewer_due ON commercial_reviews (reviewer_id, state, due_at, id);
CREATE INDEX commercial_reviews_backup_due ON commercial_reviews (backup_id, state, due_at, id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL,
  quote_version_id TEXT REFERENCES quote_versions (id),
  change_version_id TEXT REFERENCES change_versions (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  grant_id TEXT NOT NULL REFERENCES place_grants (id),
  terms_hash TEXT NOT NULL,
  reading_artifact_ref TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'decline')),
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  CONSTRAINT approvals_version CHECK ((quote_version_id IS NULL) <> (change_version_id IS NULL))
);
CREATE UNIQUE INDEX approvals_quote ON approvals (quote_version_id) WHERE quote_version_id IS NOT NULL;
CREATE UNIQUE INDEX approvals_change ON approvals (change_version_id) WHERE change_version_id IS NOT NULL;
CREATE INDEX approvals_grant ON approvals (grant_id);

CREATE TABLE contract_notices (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  quote_version_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  terms_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('early_start_request', 'early_start_acknowledgement', 'withdrawal')),
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  FOREIGN KEY (quote_version_id, job_id) REFERENCES quote_versions (id, job_id),
  UNIQUE (quote_version_id, kind)
);
CREATE INDEX contract_notices_job_time ON contract_notices (job_id, at, id);

-- Commands insert the snapshot and its lines as a draft. Review and issue only advance
-- state; they never replace the text, prices or terms in the reviewed snapshot.
CREATE TRIGGER terms_versions_no_replace BEFORE INSERT ON terms_versions
WHEN EXISTS (SELECT 1 FROM terms_versions WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'commercial terms are immutable'); END;

CREATE TRIGGER terms_versions_immutable BEFORE UPDATE ON terms_versions
BEGIN SELECT RAISE(ABORT, 'commercial terms are immutable'); END;

CREATE TRIGGER quote_versions_start_draft BEFORE INSERT ON quote_versions
WHEN NEW.state <> 'draft' OR EXISTS (
  SELECT 1 FROM quote_versions WHERE state <> 'draft' AND (id = NEW.id OR (quote_id = NEW.quote_id AND no = NEW.no))
)
BEGIN SELECT RAISE(ABORT, 'quote version must be a new draft'); END;

CREATE TRIGGER quote_versions_lock BEFORE UPDATE ON quote_versions
WHEN NEW.id IS NOT OLD.id OR NEW.quote_id IS NOT OLD.quote_id OR NEW.job_id IS NOT OLD.job_id
  OR NEW.business_id IS NOT OLD.business_id OR NEW.no IS NOT OLD.no OR NEW.author_id IS NOT OLD.author_id
  OR NEW.terms_id IS NOT OLD.terms_id OR NEW.original_locale IS NOT OLD.original_locale
  OR NEW.scope IS NOT OLD.scope OR NEW.exclusions IS NOT OLD.exclusions OR NEW.net_minor IS NOT OLD.net_minor
  OR NEW.tax_minor IS NOT OLD.tax_minor OR NEW.total_minor IS NOT OLD.total_minor OR NEW.currency IS NOT OLD.currency
  OR (OLD.issued_at IS NOT NULL AND (
    NEW.publisher_id IS NOT OLD.publisher_id OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  ))
  OR (NEW.state <> OLD.state AND NOT (
    (OLD.state = 'draft' AND NEW.state IN ('in_review', 'issued'))
    OR (OLD.state = 'in_review' AND NEW.state IN ('returned', 'issued'))
    OR (OLD.state = 'issued' AND NEW.state IN ('approved', 'declined', 'superseded', 'withdrawn'))
    OR (OLD.state = 'declined' AND NEW.state = 'superseded')
  ))
  OR (NEW.state <> OLD.state AND NEW.state IN ('approved', 'declined') AND NOT EXISTS (
    SELECT 1 FROM approvals WHERE quote_version_id = OLD.id
      AND decision = CASE NEW.state WHEN 'approved' THEN 'approve' ELSE 'decline' END
  ))
BEGIN SELECT RAISE(ABORT, 'quote snapshot is immutable or transition is invalid'); END;

CREATE TRIGGER quote_versions_keep_history BEFORE DELETE ON quote_versions
WHEN OLD.state <> 'draft'
BEGIN SELECT RAISE(ABORT, 'quote snapshot is immutable'); END;

CREATE TRIGGER quote_items_lock_insert BEFORE INSERT ON quote_items
WHEN EXISTS (SELECT 1 FROM quote_versions WHERE id = NEW.version_id AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'quote lines are immutable'); END;
CREATE TRIGGER quote_items_lock_update BEFORE UPDATE ON quote_items
WHEN EXISTS (SELECT 1 FROM quote_versions WHERE id IN (OLD.version_id, NEW.version_id) AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'quote lines are immutable'); END;
CREATE TRIGGER quote_items_lock_delete BEFORE DELETE ON quote_items
WHEN EXISTS (SELECT 1 FROM quote_versions WHERE id = OLD.version_id AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'quote lines are immutable'); END;

CREATE TRIGGER change_proposals_approved_base BEFORE INSERT ON change_proposals
WHEN NOT EXISTS (SELECT 1 FROM quote_versions WHERE id = NEW.base_quote_version_id AND job_id = NEW.job_id AND state = 'approved')
  OR EXISTS (SELECT 1 FROM change_proposals WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'change proposal requires a new ID and an approved quote for this job'); END;
CREATE TRIGGER change_proposals_lock BEFORE UPDATE ON change_proposals
BEGIN SELECT RAISE(ABORT, 'change proposal base is immutable'); END;

CREATE TRIGGER change_versions_start_draft BEFORE INSERT ON change_versions
WHEN NEW.state <> 'draft' OR EXISTS (
  SELECT 1 FROM change_versions WHERE state <> 'draft' AND (id = NEW.id OR (proposal_id = NEW.proposal_id AND no = NEW.no))
)
BEGIN SELECT RAISE(ABORT, 'change version must be a new draft'); END;

CREATE TRIGGER change_versions_lock BEFORE UPDATE ON change_versions
WHEN NEW.id IS NOT OLD.id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.job_id IS NOT OLD.job_id
  OR NEW.business_id IS NOT OLD.business_id OR NEW.no IS NOT OLD.no OR NEW.author_id IS NOT OLD.author_id
  OR NEW.terms_id IS NOT OLD.terms_id OR NEW.original_locale IS NOT OLD.original_locale OR NEW.original_text IS NOT OLD.original_text
  OR NEW.delta_minor IS NOT OLD.delta_minor OR NEW.total_minor IS NOT OLD.total_minor
  OR NEW.timing IS NOT OLD.timing OR NEW.affected_items IS NOT OLD.affected_items
  OR (OLD.issued_at IS NOT NULL AND (
    NEW.publisher_id IS NOT OLD.publisher_id OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  ))
  OR (NEW.state <> OLD.state AND NOT (
    (OLD.state = 'draft' AND NEW.state IN ('in_review', 'issued'))
    OR (OLD.state = 'in_review' AND NEW.state IN ('returned', 'issued'))
    OR (OLD.state = 'issued' AND NEW.state IN ('approved', 'rejected', 'superseded', 'withdrawn'))
    OR (OLD.state = 'rejected' AND NEW.state = 'superseded')
  ))
  OR (NEW.state <> OLD.state AND NEW.state IN ('approved', 'rejected') AND NOT EXISTS (
    SELECT 1 FROM approvals WHERE change_version_id = OLD.id
      AND decision = CASE NEW.state WHEN 'approved' THEN 'approve' ELSE 'decline' END
  ))
BEGIN SELECT RAISE(ABORT, 'change snapshot is immutable or transition is invalid'); END;

CREATE TRIGGER change_versions_keep_history BEFORE DELETE ON change_versions
WHEN OLD.state <> 'draft'
BEGIN SELECT RAISE(ABORT, 'change snapshot is immutable'); END;

CREATE TRIGGER change_items_lock_insert BEFORE INSERT ON change_items
WHEN EXISTS (SELECT 1 FROM change_versions WHERE id = NEW.version_id AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'change lines are immutable'); END;
CREATE TRIGGER change_items_lock_update BEFORE UPDATE ON change_items
WHEN EXISTS (SELECT 1 FROM change_versions WHERE id IN (OLD.version_id, NEW.version_id) AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'change lines are immutable'); END;
CREATE TRIGGER change_items_lock_delete BEFORE DELETE ON change_items
WHEN EXISTS (SELECT 1 FROM change_versions WHERE id = OLD.version_id AND state <> 'draft')
BEGIN SELECT RAISE(ABORT, 'change lines are immutable'); END;

-- Insert the exact decision, then advance its version in the same guarded batch.
-- Session, business-role and any reading-artifact scope remain command predicates.
CREATE TRIGGER approvals_exact_quote BEFORE INSERT ON approvals
WHEN NEW.quote_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM quote_versions AS v
  JOIN terms_versions AS t ON t.id = v.terms_id
  JOIN jobs AS j ON j.id = v.job_id
  JOIN places AS p ON p.id = j.place_id AND p.named_approver_id = NEW.account_id
  JOIN place_grants AS g ON g.id = NEW.grant_id AND g.place_id = p.id AND g.account_id = NEW.account_id
  WHERE v.id = NEW.quote_version_id AND v.state = 'issued' AND t.hash = NEW.terms_hash
    AND NEW.account_id NOT IN (v.author_id, v.publisher_id) AND NEW.at >= v.issued_at AND NEW.at < v.expires_at
    AND g.capability = 'approve' AND g.revoked_at IS NULL AND g.valid_from <= NEW.at AND (g.valid_until IS NULL OR NEW.at < g.valid_until)
)
BEGIN SELECT RAISE(ABORT, 'decision does not match the live quote, terms or approver'); END;

CREATE TRIGGER approvals_exact_change BEFORE INSERT ON approvals
WHEN NEW.change_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM change_versions AS v
  JOIN terms_versions AS t ON t.id = v.terms_id
  JOIN jobs AS j ON j.id = v.job_id
  JOIN places AS p ON p.id = j.place_id AND p.named_approver_id = NEW.account_id
  JOIN place_grants AS g ON g.id = NEW.grant_id AND g.place_id = p.id AND g.account_id = NEW.account_id
  WHERE v.id = NEW.change_version_id AND v.state = 'issued' AND t.hash = NEW.terms_hash
    AND NEW.account_id NOT IN (v.author_id, v.publisher_id) AND NEW.at >= v.issued_at AND NEW.at < v.expires_at
    AND g.capability = 'approve' AND g.revoked_at IS NULL AND g.valid_from <= NEW.at AND (g.valid_until IS NULL OR NEW.at < g.valid_until)
)
BEGIN SELECT RAISE(ABORT, 'decision does not match the live change, terms or approver'); END;

CREATE TRIGGER approvals_no_replace BEFORE INSERT ON approvals
WHEN EXISTS (
  SELECT 1 FROM approvals WHERE id = NEW.id
    OR quote_version_id = NEW.quote_version_id OR change_version_id = NEW.change_version_id
)
BEGIN SELECT RAISE(ABORT, 'commercial decision already recorded'); END;

CREATE TRIGGER approvals_immutable_update BEFORE UPDATE ON approvals
BEGIN SELECT RAISE(ABORT, 'commercial decisions are immutable'); END;
CREATE TRIGGER approvals_immutable_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'commercial decisions are immutable'); END;

-- The job/contract relationship is structural. The entitled party and legal
-- applicability are command guards; a provider response is not one of them.
CREATE TRIGGER contract_notices_exact_version BEFORE INSERT ON contract_notices
WHEN NOT EXISTS (
  SELECT 1 FROM quote_versions AS v
  JOIN terms_versions AS t ON t.id = v.terms_id
  JOIN approvals AS a ON a.quote_version_id = v.id AND a.decision = 'approve'
  WHERE v.id = NEW.quote_version_id AND v.job_id = NEW.job_id AND v.state = 'approved'
    AND t.hash = NEW.terms_hash AND NEW.at >= a.at
) OR (NEW.kind = 'early_start_acknowledgement' AND NOT EXISTS (
  SELECT 1 FROM contract_notices WHERE quote_version_id = NEW.quote_version_id
    AND kind = 'early_start_request' AND account_id = NEW.account_id AND at <= NEW.at
)) OR EXISTS (
  SELECT 1 FROM contract_notices WHERE id = NEW.id OR (quote_version_id = NEW.quote_version_id AND kind = NEW.kind)
)
BEGIN SELECT RAISE(ABORT, 'notice does not match the approved contract'); END;

CREATE TRIGGER contract_notices_immutable_update BEFORE UPDATE ON contract_notices
BEGIN SELECT RAISE(ABORT, 'contract notices are append-only'); END;
CREATE TRIGGER contract_notices_immutable_delete BEFORE DELETE ON contract_notices
BEGIN SELECT RAISE(ABORT, 'contract notices are append-only'); END;

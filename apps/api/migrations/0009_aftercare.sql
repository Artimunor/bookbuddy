CREATE TABLE completions (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  base_quote_version_id TEXT NOT NULL,
  no INTEGER NOT NULL CHECK (typeof(no) = 'integer' AND no > 0),
  submitter_id TEXT NOT NULL REFERENCES accounts (id),
  finished_at INTEGER NOT NULL CHECK (typeof(finished_at) = 'integer'),
  submitted_at INTEGER NOT NULL CHECK (typeof(submitted_at) = 'integer' AND submitted_at >= finished_at),
  bill_reference_hint TEXT,
  state TEXT NOT NULL CHECK (state IN ('submitted', 'returned', 'superseded', 'signed_off')),
  FOREIGN KEY (base_quote_version_id, job_id) REFERENCES quote_versions (id, job_id),
  UNIQUE (id, job_id),
  UNIQUE (job_id, no)
);
CREATE UNIQUE INDEX completions_current ON completions (job_id) WHERE state <> 'superseded';
CREATE INDEX completions_base_quote ON completions (base_quote_version_id, job_id);

CREATE TABLE completion_items (
  id TEXT PRIMARY KEY NOT NULL,
  completion_id TEXT NOT NULL REFERENCES completions (id),
  quote_version_id TEXT,
  change_version_id TEXT,
  line_no INTEGER NOT NULL CHECK (typeof(line_no) = 'integer' AND line_no > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('done', 'not_done')),
  original_language TEXT NOT NULL,
  result_note TEXT,
  not_done_reason TEXT,
  evidence_alternative TEXT,
  CONSTRAINT completion_items_source CHECK ((quote_version_id IS NULL) <> (change_version_id IS NULL)),
  CONSTRAINT completion_items_explanation CHECK (
    (outcome = 'done' AND result_note IS NOT NULL AND length(trim(result_note, char(9, 10, 11, 12, 13, 32))) > 0 AND not_done_reason IS NULL)
    OR (outcome = 'not_done' AND not_done_reason IS NOT NULL AND length(trim(not_done_reason, char(9, 10, 11, 12, 13, 32))) > 0 AND result_note IS NULL AND evidence_alternative IS NULL)
  ),
  CONSTRAINT completion_items_alternative CHECK (
    evidence_alternative IS NULL OR length(trim(evidence_alternative, char(9, 10, 11, 12, 13, 32))) > 0
  ),
  FOREIGN KEY (quote_version_id, line_no) REFERENCES quote_items (version_id, line_no),
  FOREIGN KEY (change_version_id, line_no) REFERENCES change_items (version_id, line_no),
  UNIQUE (id, completion_id)
);
CREATE UNIQUE INDEX completion_items_quote ON completion_items (completion_id, line_no) WHERE quote_version_id IS NOT NULL;
CREATE UNIQUE INDEX completion_items_change ON completion_items (completion_id, change_version_id, line_no) WHERE change_version_id IS NOT NULL;
CREATE INDEX completion_items_completion ON completion_items (completion_id, id);
CREATE INDEX completion_items_quote_source ON completion_items (quote_version_id, line_no) WHERE quote_version_id IS NOT NULL;
CREATE INDEX completion_items_change_source ON completion_items (change_version_id, line_no) WHERE change_version_id IS NOT NULL;

CREATE TABLE sign_offs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  completion_id TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES accounts (id),
  grant_id TEXT NOT NULL REFERENCES place_grants (id),
  terms_hash TEXT NOT NULL CHECK (length(terms_hash) > 0),
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  FOREIGN KEY (completion_id, job_id) REFERENCES completions (id, job_id)
);
CREATE INDEX sign_offs_completion ON sign_offs (completion_id, job_id);
CREATE INDEX sign_offs_grant ON sign_offs (grant_id);

-- Submit header, exact approved items and the received evidence links in one guarded batch.
-- The command checks complete scope, upload/alternative requirements and the actor's live context.
CREATE TRIGGER completions_submit BEFORE INSERT ON completions
WHEN NEW.state <> 'submitted' OR NOT EXISTS (
  SELECT 1 FROM quote_versions AS q
  JOIN approvals AS a ON a.quote_version_id = q.id AND a.decision = 'approve'
  JOIN jobs AS j ON j.id = q.job_id AND j.state <> 'cancelled'
  WHERE q.id = NEW.base_quote_version_id AND q.job_id = NEW.job_id AND q.state = 'approved' AND a.at <= NEW.submitted_at
) OR EXISTS (SELECT 1 FROM completions WHERE id = NEW.id OR (job_id = NEW.job_id AND no = NEW.no))
BEGIN SELECT RAISE(ABORT, 'completion requires a new version of an approved scope'); END;

CREATE TRIGGER completions_no_replace BEFORE INSERT ON completions
WHEN EXISTS (SELECT 1 FROM completions WHERE job_id = NEW.job_id AND state <> 'superseded')
BEGIN SELECT RAISE(ABORT, 'job already has a current completion'); END;

CREATE TRIGGER completions_keep_history BEFORE DELETE ON completions
BEGIN SELECT RAISE(ABORT, 'completion submissions are immutable'); END;

CREATE TRIGGER completions_lock BEFORE UPDATE ON completions
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.base_quote_version_id IS NOT OLD.base_quote_version_id
  OR NEW.no IS NOT OLD.no OR NEW.submitter_id IS NOT OLD.submitter_id OR NEW.finished_at IS NOT OLD.finished_at
  OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.bill_reference_hint IS NOT OLD.bill_reference_hint
  OR (NEW.state <> OLD.state AND NOT (
    (OLD.state = 'submitted' AND NEW.state IN ('returned', 'superseded'))
    OR (OLD.state = 'returned' AND NEW.state = 'superseded')
    OR (OLD.state = 'submitted' AND NEW.state = 'signed_off' AND EXISTS (
      SELECT 1 FROM sign_offs WHERE completion_id = OLD.id AND job_id = OLD.job_id
    ))
  ))
BEGIN SELECT RAISE(ABORT, 'completion snapshot is immutable or transition is invalid'); END;

CREATE TRIGGER completion_items_exact_scope BEFORE INSERT ON completion_items
WHEN NOT EXISTS (
  SELECT 1 FROM completions AS c WHERE c.id = NEW.completion_id AND c.state = 'submitted' AND (
    NEW.quote_version_id = c.base_quote_version_id OR EXISTS (
      SELECT 1 FROM change_versions AS v JOIN change_proposals AS p ON p.id = v.proposal_id
      JOIN approvals AS a ON a.change_version_id = v.id AND a.decision = 'approve'
      WHERE v.id = NEW.change_version_id AND v.job_id = c.job_id AND v.state = 'approved'
        AND p.base_quote_version_id = c.base_quote_version_id AND a.at <= c.submitted_at
    )
  )
) OR EXISTS (
  SELECT 1 FROM completion_items WHERE id = NEW.id OR (completion_id = NEW.completion_id AND line_no = NEW.line_no
    AND quote_version_id IS NEW.quote_version_id AND change_version_id IS NEW.change_version_id)
)
BEGIN SELECT RAISE(ABORT, 'completion item must be a new line of its exact approved scope'); END;

CREATE TRIGGER completion_items_keep_history BEFORE DELETE ON completion_items
BEGIN SELECT RAISE(ABORT, 'completion items are immutable'); END;
CREATE TRIGGER completion_items_lock BEFORE UPDATE ON completion_items
BEGIN SELECT RAISE(ABORT, 'completion items are immutable'); END;

CREATE TRIGGER sign_offs_exact_submission BEFORE INSERT ON sign_offs
BEGIN
  SELECT RAISE(ABORT, 'job already signed off')
  WHERE EXISTS (SELECT 1 FROM sign_offs WHERE id = NEW.id OR job_id = NEW.job_id);
  SELECT RAISE(ABORT, 'sign-off requires the current complete submission, terms and named sign-off grant')
  WHERE NOT EXISTS (
  SELECT 1 FROM completions AS c
  JOIN jobs AS j ON j.id = c.job_id AND j.state <> 'cancelled'
  JOIN places AS p ON p.id = j.place_id AND p.named_approver_id = NEW.approver_id AND p.state IN ('in_area', 'out_of_area')
  JOIN accounts AS actor ON actor.id = NEW.approver_id AND actor.state = 'active'
  JOIN place_grants AS g ON g.id = NEW.grant_id AND g.place_id = p.id AND g.account_id = NEW.approver_id
  JOIN quote_versions AS q ON q.id = c.base_quote_version_id AND q.state = 'approved'
  JOIN terms_versions AS t ON t.id = q.terms_id AND t.hash = NEW.terms_hash
  WHERE c.id = NEW.completion_id AND j.id = NEW.job_id AND c.state = 'submitted' AND c.submitter_id <> NEW.approver_id
    AND c.submitted_at <= NEW.at AND g.capability = 'sign_off' AND g.revoked_at IS NULL
    AND g.valid_from <= NEW.at AND (g.valid_until IS NULL OR NEW.at < g.valid_until)
    AND EXISTS (SELECT 1 FROM completion_items WHERE completion_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM quote_items AS line WHERE line.version_id = q.id AND NOT EXISTS (
        SELECT 1 FROM completion_items AS i WHERE i.completion_id = c.id AND i.quote_version_id = q.id AND i.line_no = line.line_no
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM change_proposals AS proposal JOIN change_versions AS v ON v.proposal_id = proposal.id AND v.state = 'approved'
      JOIN change_items AS line ON line.version_id = v.id
      WHERE proposal.base_quote_version_id = q.id AND proposal.job_id = j.id AND NOT EXISTS (
        SELECT 1 FROM completion_items AS i WHERE i.completion_id = c.id AND i.change_version_id = v.id AND i.line_no = line.line_no
      )
    )
  );
END;

CREATE TRIGGER sign_offs_advance_completion AFTER INSERT ON sign_offs
BEGIN UPDATE completions SET state = 'signed_off' WHERE id = NEW.completion_id; END;

CREATE TRIGGER sign_offs_lock BEFORE UPDATE ON sign_offs
BEGIN SELECT RAISE(ABORT, 'sign-offs are immutable'); END;
CREATE TRIGGER sign_offs_keep_history BEFORE DELETE ON sign_offs
BEGIN SELECT RAISE(ABORT, 'sign-offs are immutable'); END;

CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  number TEXT NOT NULL CHECK (length(trim(number)) > 0),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  replaces_id TEXT,
  net_minor INTEGER NOT NULL CHECK (typeof(net_minor) = 'integer' AND net_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (typeof(tax_minor) = 'integer' AND tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor) = 'integer' AND total_minor > 0 AND total_minor = net_minor + tax_minor),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  provider_document_ref TEXT NOT NULL CHECK (length(trim(provider_document_ref)) > 0),
  payment_instructions TEXT NOT NULL CHECK (CASE WHEN json_valid(payment_instructions) THEN json_type(payment_instructions) = 'object' ELSE 0 END),
  line_items TEXT NOT NULL CHECK (CASE WHEN json_valid(line_items) THEN json_array_length(line_items) > 0 ELSE 0 END),
  issued_at INTEGER NOT NULL CHECK (typeof(issued_at) = 'integer'),
  due_at INTEGER NOT NULL CHECK (typeof(due_at) = 'integer' AND due_at >= issued_at),
  state TEXT NOT NULL CHECK (state IN ('issued', 'replaced', 'void')),
  FOREIGN KEY (job_id, business_id) REFERENCES jobs (id, business_id),
  FOREIGN KEY (replaces_id, job_id) REFERENCES bills (id, job_id),
  UNIQUE (id, job_id),
  UNIQUE (business_id, number, version),
  CONSTRAINT bills_version_chain CHECK ((version = 1) = (replaces_id IS NULL))
);
CREATE UNIQUE INDEX bills_effective ON bills (job_id) WHERE state = 'issued';
CREATE UNIQUE INDEX bills_replaces ON bills (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE INDEX bills_job_history ON bills (job_id, issued_at, id);
CREATE INDEX bills_issued_due ON bills (due_at, id) WHERE state = 'issued';

-- Replacing a bill changes the invoice, not the payment record on the old version.
CREATE TRIGGER bills_issue BEFORE INSERT ON bills
WHEN NEW.state <> 'issued' OR EXISTS (
  SELECT 1 FROM bills WHERE id = NEW.id OR (business_id = NEW.business_id AND number = NEW.number AND version = NEW.version)
    OR replaces_id = NEW.replaces_id
) OR (NEW.replaces_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM bills AS b WHERE b.id = NEW.replaces_id AND b.job_id = NEW.job_id AND b.business_id = NEW.business_id
    AND b.state = 'replaced' AND b.version + 1 = NEW.version AND b.issued_at <= NEW.issued_at
    AND (b.number <> NEW.number OR b.net_minor <> NEW.net_minor OR b.tax_minor <> NEW.tax_minor OR b.due_at <> NEW.due_at
      OR b.provider_document_ref <> NEW.provider_document_ref OR b.payment_instructions <> NEW.payment_instructions
      OR b.line_items <> NEW.line_items)
))
BEGIN SELECT RAISE(ABORT, 'bill requires a new issued version'); END;

CREATE TRIGGER bills_no_replace BEFORE INSERT ON bills
WHEN EXISTS (SELECT 1 FROM bills WHERE job_id = NEW.job_id AND state = 'issued')
BEGIN SELECT RAISE(ABORT, 'job already has an effective bill'); END;

CREATE TRIGGER bills_lock BEFORE UPDATE ON bills
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.business_id IS NOT OLD.business_id OR NEW.number IS NOT OLD.number
  OR NEW.version IS NOT OLD.version OR NEW.replaces_id IS NOT OLD.replaces_id OR NEW.net_minor IS NOT OLD.net_minor
  OR NEW.tax_minor IS NOT OLD.tax_minor OR NEW.total_minor IS NOT OLD.total_minor OR NEW.currency IS NOT OLD.currency
  OR NEW.provider_document_ref IS NOT OLD.provider_document_ref OR NEW.payment_instructions IS NOT OLD.payment_instructions
  OR NEW.line_items IS NOT OLD.line_items OR NEW.issued_at IS NOT OLD.issued_at OR NEW.due_at IS NOT OLD.due_at
  OR (NEW.state <> OLD.state AND (OLD.state <> 'issued' OR NEW.state NOT IN ('replaced', 'void')))
BEGIN SELECT RAISE(ABORT, 'invoice snapshot is immutable or transition is invalid'); END;

CREATE TRIGGER bills_keep_history BEFORE DELETE ON bills
BEGIN SELECT RAISE(ABORT, 'invoice snapshots are immutable'); END;

CREATE TABLE paid_records (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL REFERENCES bills (id),
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL CHECK (kind IN ('matched', 'checking', 'corrected', 'no_funds_received', 'refund_recorded')),
  prior_id TEXT,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor > 0)),
  verified_reference TEXT CHECK (verified_reference IS NULL OR length(trim(verified_reference)) > 0),
  reason TEXT CHECK (reason IS NULL OR length(trim(reason, char(9, 10, 11, 12, 13, 32))) > 0),
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  FOREIGN KEY (prior_id, bill_id) REFERENCES paid_records (id, bill_id),
  UNIQUE (id, bill_id),
  CONSTRAINT paid_records_content CHECK (
    (kind IN ('matched', 'refund_recorded') AND amount_minor IS NOT NULL AND verified_reference IS NOT NULL)
    OR (kind IN ('checking', 'corrected', 'no_funds_received') AND amount_minor IS NULL AND verified_reference IS NULL AND reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX paid_records_bill_root ON paid_records (bill_id) WHERE prior_id IS NULL;
CREATE UNIQUE INDEX paid_records_next ON paid_records (prior_id) WHERE prior_id IS NOT NULL;
CREATE INDEX paid_records_bill_time ON paid_records (bill_id, at, id);

-- prior_id is a compare-and-set on the effective record; time is attribution, not chain order.
-- The command also authenticates the session, active provider context and live grant at server time.
CREATE TRIGGER paid_records_append BEFORE INSERT ON paid_records
WHEN NOT EXISTS (
  SELECT 1 FROM bills AS b
  JOIN businesses AS provider ON provider.id = b.business_id AND provider.state = 'approved'
  JOIN memberships AS m ON m.business_id = provider.id AND m.account_id = NEW.actor_id AND m.state = 'active'
  JOIN accounts AS actor ON actor.id = m.account_id AND actor.state = 'active'
  JOIN membership_roles AS r ON r.membership_id = m.id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= NEW.at
  JOIN business_grants AS g ON g.membership_id = m.id AND g.capability = 'record_paid' AND g.revoked_at IS NULL
    AND g.valid_from <= NEW.at AND (g.valid_until IS NULL OR NEW.at < g.valid_until)
  WHERE b.id = NEW.bill_id AND NEW.at >= b.issued_at
    AND (b.state = 'issued' OR NEW.kind IN ('corrected', 'refund_recorded'))
    AND (NEW.kind <> 'matched' OR NEW.amount_minor = b.total_minor)
) OR EXISTS (
  SELECT 1 FROM paid_records WHERE id = NEW.id OR (bill_id = NEW.bill_id AND prior_id IS NEW.prior_id)
) OR NOT (
  (NEW.prior_id IS NULL AND NEW.kind IN ('matched', 'checking')) OR EXISTS (
    SELECT 1 FROM paid_records AS prior WHERE prior.id = NEW.prior_id AND prior.bill_id = NEW.bill_id AND prior.at <= NEW.at AND (
      (prior.kind = 'matched' AND (NEW.kind = 'corrected' OR (NEW.kind = 'refund_recorded' AND NEW.amount_minor <= prior.amount_minor)))
      OR (prior.kind IN ('checking', 'corrected') AND NEW.kind IN ('matched', 'no_funds_received'))
      OR (prior.kind = 'no_funds_received' AND NEW.kind IN ('matched', 'checking'))
      OR (prior.kind = 'refund_recorded' AND NEW.kind = 'matched')
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'payment record requires live provider billing authority and the current record'); END;

CREATE TRIGGER paid_records_lock BEFORE UPDATE ON paid_records
BEGIN SELECT RAISE(ABORT, 'payment records are append-only'); END;
CREATE TRIGGER paid_records_keep_history BEFORE DELETE ON paid_records
BEGIN SELECT RAISE(ABORT, 'payment records are append-only'); END;

CREATE TABLE problem_cases (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  reference TEXT NOT NULL UNIQUE CHECK (reference GLOB 'BB-[A-Z0-9]*' AND substr(reference, 4) NOT GLOB '*[^A-Z0-9]*'),
  reporter_id TEXT NOT NULL REFERENCES accounts (id),
  case_owner_id TEXT NOT NULL REFERENCES accounts (id),
  category TEXT NOT NULL CHECK (category IN ('quality', 'damage', 'bill', 'timing', 'other')),
  provider_audience TEXT CHECK (provider_audience IN ('provider_billing', 'provider_rectification')),
  bill_id TEXT,
  quote_version_id TEXT,
  change_version_id TEXT,
  line_no INTEGER,
  state TEXT NOT NULL CHECK (state IN ('open', 'awaiting_plan', 'resolved', 'closed')),
  opened_at INTEGER NOT NULL CHECK (typeof(opened_at) = 'integer'),
  acknowledge_by INTEGER NOT NULL CHECK (typeof(acknowledge_by) = 'integer' AND acknowledge_by > opened_at),
  first_update_by INTEGER NOT NULL CHECK (typeof(first_update_by) = 'integer' AND first_update_by >= acknowledge_by),
  next_update_at INTEGER CHECK (next_update_at IS NULL OR (typeof(next_update_at) = 'integer' AND next_update_at > opened_at)),
  FOREIGN KEY (bill_id, job_id) REFERENCES bills (id, job_id),
  FOREIGN KEY (quote_version_id, line_no) REFERENCES quote_items (version_id, line_no),
  FOREIGN KEY (change_version_id, line_no) REFERENCES change_items (version_id, line_no),
  UNIQUE (id, job_id),
  CONSTRAINT problem_cases_scope_line CHECK (
    (line_no IS NULL AND quote_version_id IS NULL AND change_version_id IS NULL)
    OR (line_no IS NOT NULL AND (quote_version_id IS NULL) <> (change_version_id IS NULL))
  ),
  CONSTRAINT problem_cases_open_target CHECK ((state IN ('open', 'awaiting_plan')) = (next_update_at IS NOT NULL))
);
CREATE INDEX problem_cases_job_opened ON problem_cases (job_id, opened_at, id);
CREATE INDEX problem_cases_bill ON problem_cases (bill_id, job_id) WHERE bill_id IS NOT NULL;
CREATE INDEX problem_cases_quote_line ON problem_cases (quote_version_id, line_no) WHERE quote_version_id IS NOT NULL;
CREATE INDEX problem_cases_change_line ON problem_cases (change_version_id, line_no) WHERE change_version_id IS NOT NULL;
CREATE INDEX problem_cases_owner_due ON problem_cases (case_owner_id, next_update_at, id) WHERE next_update_at IS NOT NULL;
CREATE INDEX problem_cases_due ON problem_cases (next_update_at, id) WHERE next_update_at IS NOT NULL;

CREATE TRIGGER problem_cases_open BEFORE INSERT ON problem_cases
WHEN NEW.state <> 'open' OR NEW.next_update_at IS NOT NEW.acknowledge_by
  OR EXISTS (SELECT 1 FROM problem_cases WHERE id = NEW.id OR reference = NEW.reference)
  OR (NEW.quote_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quote_versions WHERE id = NEW.quote_version_id AND job_id = NEW.job_id AND state = 'approved'
  )) OR (NEW.change_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM change_versions WHERE id = NEW.change_version_id AND job_id = NEW.job_id AND state = 'approved'
  ))
BEGIN SELECT RAISE(ABORT, 'case requires a new receipt and an item from its approved job scope'); END;

CREATE TRIGGER problem_cases_lock BEFORE UPDATE ON problem_cases
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.reference IS NOT OLD.reference
  OR NEW.reporter_id IS NOT OLD.reporter_id OR NEW.category IS NOT OLD.category OR NEW.provider_audience IS NOT OLD.provider_audience
  OR NEW.bill_id IS NOT OLD.bill_id OR NEW.quote_version_id IS NOT OLD.quote_version_id
  OR NEW.change_version_id IS NOT OLD.change_version_id OR NEW.line_no IS NOT OLD.line_no OR NEW.opened_at IS NOT OLD.opened_at
  OR NEW.acknowledge_by IS NOT OLD.acknowledge_by OR NEW.first_update_by IS NOT OLD.first_update_by
BEGIN SELECT RAISE(ABORT, 'case receipt is immutable'); END;

CREATE TABLE case_events (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL CHECK (kind IN ('reported', 'reporter_update', 'acknowledged', 'substantive_update', 'correction_requested', 'resolved', 'closed', 'provider_packet')),
  audience TEXT NOT NULL CHECK (audience IN ('reporter_and_owner', 'provider_billing', 'provider_rectification')),
  original_text TEXT CHECK (original_text IS NULL OR length(trim(original_text, char(9, 10, 11, 12, 13, 32))) > 0),
  original_language TEXT,
  completion_id TEXT,
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  FOREIGN KEY (case_id, job_id) REFERENCES problem_cases (id, job_id),
  FOREIGN KEY (completion_id, job_id) REFERENCES completions (id, job_id),
  UNIQUE (id, case_id),
  CONSTRAINT case_events_text CHECK ((original_text IS NULL) = (original_language IS NULL)
    AND (kind IN ('acknowledged', 'closed') OR original_text IS NOT NULL)),
  CONSTRAINT case_events_correction CHECK ((kind = 'correction_requested') = (completion_id IS NOT NULL)),
  CONSTRAINT case_events_provider_packet CHECK ((kind = 'provider_packet') = (audience <> 'reporter_and_owner'))
);
CREATE UNIQUE INDEX case_events_report ON case_events (case_id) WHERE kind = 'reported';
CREATE INDEX case_events_timeline ON case_events (case_id, audience, at, id);
CREATE INDEX case_events_completion ON case_events (completion_id, job_id) WHERE completion_id IS NOT NULL;

-- A case event never changes a completion, invoice or payment on its own. The
-- command derives the disclosed audience and staffed-calendar targets, and
-- explicitly guards any requested return of the current unsigned submission.
CREATE TRIGGER case_events_append BEFORE INSERT ON case_events
WHEN EXISTS (SELECT 1 FROM case_events WHERE id = NEW.id OR (case_id = NEW.case_id AND kind = 'reported' AND NEW.kind = 'reported'))
  OR NOT EXISTS (
    SELECT 1 FROM problem_cases AS c WHERE c.id = NEW.case_id AND c.job_id = NEW.job_id AND c.opened_at <= NEW.at
      AND (NEW.kind NOT IN ('reported', 'reporter_update') OR NEW.actor_id = c.reporter_id)
      AND (NEW.kind NOT IN ('acknowledged', 'correction_requested', 'resolved', 'closed', 'provider_packet') OR NEW.actor_id = c.case_owner_id)
      AND (NEW.kind <> 'substantive_update' OR NEW.actor_id = c.case_owner_id OR EXISTS (
        SELECT 1 FROM case_grants AS g
        JOIN account_contexts AS ctx ON ctx.id = g.context_id AND ctx.account_id = NEW.actor_id
        JOIN membership_roles AS r ON r.id = ctx.role_grant_id AND r.revoked_at IS NULL AND r.granted_at <= NEW.at
        JOIN memberships AS m ON m.id = r.membership_id AND m.state = 'active'
        WHERE g.case_id = c.id AND g.capability = c.provider_audience AND g.revoked_at IS NULL
          AND g.valid_from <= NEW.at AND NEW.at < g.valid_until
      ))
      AND (NEW.kind <> 'provider_packet' OR NEW.audience = c.provider_audience)
      AND (NEW.completion_id IS NULL OR EXISTS (
        SELECT 1 FROM completions WHERE id = NEW.completion_id AND job_id = c.job_id AND state = 'submitted'
      ))
  )
BEGIN SELECT RAISE(ABORT, 'case event requires its audience and attributed actor'); END;
CREATE TRIGGER case_events_lock BEFORE UPDATE ON case_events
BEGIN SELECT RAISE(ABORT, 'case events are append-only'); END;
CREATE TRIGGER case_events_keep_history BEFORE DELETE ON case_events
BEGIN SELECT RAISE(ABORT, 'case events are append-only'); END;

CREATE TABLE case_grants (
  case_id TEXT NOT NULL REFERENCES problem_cases (id),
  context_id TEXT NOT NULL REFERENCES account_contexts (id),
  capability TEXT NOT NULL CHECK (capability IN ('provider_billing', 'provider_rectification')),
  valid_from INTEGER NOT NULL CHECK (typeof(valid_from) = 'integer'),
  valid_until INTEGER NOT NULL CHECK (typeof(valid_until) = 'integer' AND valid_until > valid_from),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= valid_from)),
  PRIMARY KEY (case_id, context_id, capability, valid_from)
);
CREATE UNIQUE INDEX case_grants_current ON case_grants (case_id, context_id, capability) WHERE revoked_at IS NULL;
CREATE INDEX case_grants_context ON case_grants (context_id, case_id, capability);
CREATE INDEX case_grants_due ON case_grants (valid_until, case_id, context_id) WHERE revoked_at IS NULL;

CREATE TRIGGER case_grants_same_provider BEFORE INSERT ON case_grants
WHEN NOT EXISTS (
  SELECT 1 FROM problem_cases AS c JOIN jobs AS j ON j.id = c.job_id
  JOIN account_contexts AS ctx ON ctx.id = NEW.context_id AND ctx.business_id = j.business_id
  WHERE c.id = NEW.case_id AND c.provider_audience = NEW.capability
    AND (ctx.role = 'provider_admin' OR (NEW.capability = 'provider_rectification' AND ctx.role = 'foreman'))
)
BEGIN SELECT RAISE(ABORT, 'case grant must be for a named recipient of the disclosed provider packet'); END;

CREATE TRIGGER case_grants_lock BEFORE UPDATE ON case_grants
WHEN NEW.case_id IS NOT OLD.case_id OR NEW.context_id IS NOT OLD.context_id OR NEW.capability IS NOT OLD.capability
  OR NEW.valid_from IS NOT OLD.valid_from OR NEW.valid_until IS NOT OLD.valid_until
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN SELECT RAISE(ABORT, 'case grant can only be revoked'); END;

CREATE TABLE bill_deferrals (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES accounts (id),
  grant_id TEXT NOT NULL REFERENCES business_grants (id),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  basis TEXT NOT NULL CHECK (length(trim(basis, char(9, 10, 11, 12, 13, 32))) > 0),
  affected_line_nos TEXT NOT NULL CHECK (CASE WHEN json_valid(affected_line_nos) THEN json_array_length(affected_line_nos) > 0 ELSE 0 END),
  at INTEGER NOT NULL CHECK (typeof(at) = 'integer'),
  review_at INTEGER NOT NULL CHECK (typeof(review_at) = 'integer' AND review_at > at),
  released_at INTEGER,
  released_by TEXT REFERENCES accounts (id),
  release_grant_id TEXT REFERENCES business_grants (id),
  disposition TEXT CHECK (disposition IN ('resume_collection', 'invoice_correction', 'refund_instruction')),
  FOREIGN KEY (bill_id, job_id) REFERENCES bills (id, job_id),
  FOREIGN KEY (case_id, job_id) REFERENCES problem_cases (id, job_id),
  CONSTRAINT bill_deferrals_disposition CHECK (
    (released_at IS NULL AND released_by IS NULL AND release_grant_id IS NULL AND disposition IS NULL)
    OR (typeof(released_at) = 'integer' AND released_at >= at AND released_by IS NOT NULL AND release_grant_id IS NOT NULL AND disposition IS NOT NULL)
  )
);
CREATE UNIQUE INDEX bill_deferrals_active ON bill_deferrals (bill_id) WHERE released_at IS NULL;
CREATE INDEX bill_deferrals_bill_history ON bill_deferrals (bill_id, at, id);
CREATE INDEX bill_deferrals_case ON bill_deferrals (case_id, job_id);
CREATE INDEX bill_deferrals_grant ON bill_deferrals (grant_id);
CREATE INDEX bill_deferrals_release_grant ON bill_deferrals (release_grant_id) WHERE release_grant_id IS NOT NULL;
CREATE INDEX bill_deferrals_review_due ON bill_deferrals (review_at, id) WHERE released_at IS NULL;

CREATE TRIGGER bill_deferrals_authorize BEFORE INSERT ON bill_deferrals
WHEN NEW.released_at IS NOT NULL OR EXISTS (
  SELECT 1 FROM bill_deferrals WHERE id = NEW.id OR (bill_id = NEW.bill_id AND released_at IS NULL)
) OR NOT EXISTS (
  SELECT 1 FROM bills AS b JOIN problem_cases AS c ON c.id = NEW.case_id AND c.job_id = b.job_id
  JOIN businesses AS provider ON provider.id = b.business_id AND provider.state = 'approved'
  JOIN accounts AS actor ON actor.id = NEW.actor_id AND actor.state = 'active'
  JOIN business_grants AS g ON g.id = NEW.grant_id AND g.business_id = b.business_id AND g.capability = 'billing_deferral'
  JOIN memberships AS m ON m.id = g.membership_id AND m.account_id = NEW.actor_id AND m.state = 'active'
  JOIN membership_roles AS r ON r.membership_id = m.id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= NEW.at
  WHERE b.id = NEW.bill_id AND b.job_id = NEW.job_id AND b.state = 'issued' AND NEW.amount_minor <= b.total_minor
    AND c.state IN ('open', 'awaiting_plan') AND (c.bill_id IS NULL OR c.bill_id = b.id) AND NEW.at >= max(b.issued_at, c.opened_at)
    AND g.revoked_at IS NULL AND g.valid_from <= NEW.at AND (g.valid_until IS NULL OR NEW.at < g.valid_until)
    AND NOT EXISTS (
      SELECT 1 FROM paid_records AS p WHERE p.bill_id = b.id AND p.kind <> 'no_funds_received'
        AND NOT EXISTS (SELECT 1 FROM paid_records AS next WHERE next.prior_id = p.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.affected_line_nos) AS line
      WHERE line.type <> 'integer' OR line.value < 1 OR line.value > json_array_length(b.line_items)
    )
)
BEGIN SELECT RAISE(ABORT, 'deferral requires an active unpaid dispute and named provider billing authority'); END;

CREATE TRIGGER bill_deferrals_lock BEFORE UPDATE ON bill_deferrals
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.bill_id IS NOT OLD.bill_id OR NEW.case_id IS NOT OLD.case_id
  OR NEW.actor_id IS NOT OLD.actor_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.amount_minor IS NOT OLD.amount_minor
  OR NEW.basis IS NOT OLD.basis OR NEW.affected_line_nos IS NOT OLD.affected_line_nos OR NEW.at IS NOT OLD.at
  OR NEW.review_at IS NOT OLD.review_at OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NOT EXISTS (
    SELECT 1 FROM bills AS b
    JOIN businesses AS provider ON provider.id = b.business_id AND provider.state = 'approved'
    JOIN accounts AS actor ON actor.id = NEW.released_by AND actor.state = 'active'
    JOIN business_grants AS g ON g.id = NEW.release_grant_id AND g.business_id = b.business_id AND g.capability = 'billing_deferral'
    JOIN memberships AS m ON m.id = g.membership_id AND m.account_id = NEW.released_by AND m.state = 'active'
    JOIN membership_roles AS r ON r.membership_id = m.id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= NEW.released_at
    WHERE b.id = OLD.bill_id AND g.revoked_at IS NULL AND g.valid_from <= NEW.released_at
      AND (g.valid_until IS NULL OR NEW.released_at < g.valid_until)
  )
BEGIN SELECT RAISE(ABORT, 'deferral can only receive one authorised release disposition'); END;
CREATE TRIGGER bill_deferrals_keep_history BEFORE DELETE ON bill_deferrals
BEGIN SELECT RAISE(ABORT, 'billing deferrals are retained'); END;

-- Eligibility is a separate, scoped verification of closed work; a paid stamp alone does not qualify.
-- expires_at is 30 calendar days from actual service in the stored site zone, set by the issuing command.
CREATE TABLE rating_eligibilities (
  job_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  completion_id TEXT NOT NULL,
  verified_by TEXT NOT NULL REFERENCES accounts (id),
  verified_at INTEGER NOT NULL CHECK (typeof(verified_at) = 'integer'),
  expires_at INTEGER NOT NULL CHECK (typeof(expires_at) = 'integer' AND expires_at > verified_at),
  PRIMARY KEY (job_id, account_id),
  FOREIGN KEY (completion_id, job_id) REFERENCES completions (id, job_id)
);
CREATE INDEX rating_eligibilities_account_due ON rating_eligibilities (account_id, expires_at, job_id);
CREATE INDEX rating_eligibilities_completion ON rating_eligibilities (completion_id, job_id);

CREATE TRIGGER rating_eligibilities_verified_job BEFORE INSERT ON rating_eligibilities
WHEN NOT EXISTS (
  SELECT 1 FROM jobs AS j JOIN completions AS c ON c.id = NEW.completion_id AND c.job_id = j.id
  WHERE j.id = NEW.job_id AND j.state = 'closed' AND c.state IN ('submitted', 'signed_off') AND NEW.verified_at >= c.submitted_at
    AND (EXISTS (SELECT 1 FROM sign_offs WHERE job_id = j.id AND approver_id = NEW.account_id)
      OR EXISTS (SELECT 1 FROM approvals WHERE quote_version_id = c.base_quote_version_id AND account_id = NEW.account_id AND decision = 'approve')
      OR EXISTS (
        SELECT 1 FROM visits AS visit JOIN visit_windows AS window ON window.visit_id = visit.id
        WHERE visit.job_id = j.id AND visit.kind = 'work' AND visit.state = 'finished'
          AND window.state = 'confirmed' AND window.confirmed_by = NEW.account_id
      ))
)
BEGIN SELECT RAISE(ABORT, 'rating requires verified closed delivery and the customer who booked or approved it'); END;

CREATE TABLE ratings (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL REFERENCES accounts (id),
  stars INTEGER NOT NULL CHECK (typeof(stars) = 'integer' AND stars BETWEEN 1 AND 5),
  original_comment TEXT CHECK (original_comment IS NULL OR length(trim(original_comment, char(9, 10, 11, 12, 13, 32))) > 0),
  original_language TEXT,
  submitted_at INTEGER NOT NULL CHECK (typeof(submitted_at) = 'integer'),
  state TEXT NOT NULL CHECK (state IN ('submitted', 'withdrawn')),
  FOREIGN KEY (job_id, author_id) REFERENCES rating_eligibilities (job_id, account_id),
  CONSTRAINT ratings_language CHECK ((original_comment IS NULL) = (original_language IS NULL))
);
CREATE INDEX ratings_author ON ratings (author_id, submitted_at, id);

CREATE TRIGGER ratings_submit BEFORE INSERT ON ratings
WHEN NEW.state <> 'submitted' OR EXISTS (SELECT 1 FROM ratings WHERE id = NEW.id OR job_id = NEW.job_id)
  OR NOT EXISTS (
    SELECT 1 FROM rating_eligibilities AS e JOIN jobs AS j ON j.id = e.job_id AND j.state = 'closed'
    WHERE e.job_id = NEW.job_id AND e.account_id = NEW.author_id AND NEW.submitted_at >= e.verified_at AND NEW.submitted_at < e.expires_at
  )
BEGIN SELECT RAISE(ABORT, 'rating requires unused current eligibility'); END;

CREATE TRIGGER ratings_lock BEFORE UPDATE ON ratings
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.author_id IS NOT OLD.author_id OR NEW.stars IS NOT OLD.stars
  OR NEW.original_comment IS NOT OLD.original_comment OR NEW.original_language IS NOT OLD.original_language
  OR NEW.submitted_at IS NOT OLD.submitted_at OR OLD.state <> 'submitted' OR NEW.state <> 'withdrawn'
BEGIN SELECT RAISE(ABORT, 'submitted feedback can only be withdrawn'); END;
CREATE TRIGGER ratings_keep_history BEFORE DELETE ON ratings
BEGIN SELECT RAISE(ABORT, 'rating history is retained'); END;

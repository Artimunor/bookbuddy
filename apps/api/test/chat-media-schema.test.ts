import { expect, test } from "bun:test";
import {
  appendThreadEntriesRoute, chatEntryProjectionSchema, createMediaGrantsRoute, mediaUploadGrantSchema, settleMediaRoute,
} from "@bookbuddy/api-contract";
import { createTestD1 } from "./d1";
import type { TestD1 } from "./d1";

async function withJob(run: (db: TestD1) => Promise<void>) {
  const db = await createTestD1();
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, email_normalized, verified_at, state) VALUES
        ('owner', 'owner@example.test', 1, 'active'), ('foreman', 'foreman@example.test', 1, 'active')`),
      db.prepare("INSERT INTO account_contexts (id, account_id, role) VALUES ('reader', 'owner', 'customer')"),
      db.prepare("INSERT INTO operating_areas VALUES ('area', 'Area', 'Europe/Madrid', '[0]')"),
      db.prepare(`INSERT INTO businesses (id, legal_name, public_name, verified_work_contact, catchment_id, state)
        VALUES ('business', 'Provider Legal', 'Provider', 'work@example.test', 'area', 'approved')`),
      db.prepare(`INSERT INTO places (id, owner_id, alias, normalized_address, state)
        VALUES ('place', 'owner', 'Villa', 'Address', 'pending_verification')`),
      db.prepare("INSERT INTO place_people (place_id, account_id, verified_from, history_from) VALUES ('place', 'owner', 1, 1)"),
      db.prepare(`INSERT INTO jobs (id, reference, business_id, place_id, requester_id, origin, state)
        VALUES ('job', 'BB-123', 'business', 'place', 'owner', 'bookbuddy', 'open')`),
    ]);
    await run(db);
  } finally {
    db.close();
  }
}

test("conversation positions and translation targets are unique and corrections keep the original", () => withJob(async (db) => {
  const entry = (id: string, root: string, revision: number, position: number, correctsId: string | null) => db.prepare(`
    INSERT INTO chat_entries (id, root_id, thread_id, revision, position, corrects_id, source_language, original_text, received_at)
    VALUES (?, ?, 'thread', ?, ?, ?, 'es', 'Hola', 10)`).bind(id, root, revision, position, correctsId);
  const translate = (revision: number, target: string) => db.prepare(`INSERT INTO message_translations
    (root_id, revision, target_locale, source_locale, state) VALUES ('first', ?, ?, 'es', 'pending')`).bind(revision, target);
  await db.batch([
    db.prepare("INSERT INTO chat_threads (id, job_id, audience, write_state) VALUES ('thread', 'job', 'job', 'open')"),
    db.prepare("INSERT INTO chat_members (thread_id, context_id, can_send, visible_from) VALUES ('thread', 'reader', 1, 1)"),
    db.prepare("INSERT INTO chat_messages VALUES ('first', 'thread', 'reader'), ('second', 'thread', 'reader')"),
    entry("first", "first", 1, 1, null), translate(1, "en"),
  ]);
  await expect(entry("second", "second", 1, 1, null).run()).rejects.toThrow(/chat_entries.thread_id, chat_entries.position/);
  await expect(translate(1, "en").run()).rejects.toThrow(/message_translations.root_id, message_translations.revision, message_translations.target_locale/);
  const ready = db.prepare(`UPDATE message_translations SET state = 'ready', translated_text = 'Hello', provider = 'test',
    model = ?, produced_at = 12 WHERE root_id = 'first' AND revision = 1 AND target_locale = 'en'`);
  await expect(ready.bind(null).run()).rejects.toThrow(/message_translations_result/);
  await db.batch([ready.bind("test-nmt"), entry("corrected", "first", 2, 2, "first"), translate(2, "en"), translate(1, "de")]);
  await expect(entry("wrong-root", "second", 2, 3, "first").run()).rejects.toThrow(/previous revision of this message/);
  await expect(db.prepare("UPDATE chat_entries SET original_text = 'changed' WHERE id = 'first'").run()).rejects.toThrow(/append-only/);
}));

test("evidence links require an item or event from the stated parent and do not modify settled bytes", () => withJob(async (db) => {
  const completion = (id: string, no: number) => db.prepare(`INSERT INTO completions
    (id, job_id, base_quote_version_id, no, submitter_id, finished_at, submitted_at, state)
    VALUES (?, 'job', 'quote-v1', ?, 'foreman', 10, 12, 'submitted')`).bind(id, no);
  await db.batch([
    db.prepare(`UPDATE places SET named_approver_id = 'owner', pin = '{"latitude":1,"longitude":1}',
      site_zone = 'Europe/Madrid', area_id = 'area', state = 'in_area' WHERE id = 'place'`),
    db.prepare(`INSERT INTO place_grants (id, place_id, account_id, capability, issuer_id, valid_from)
      VALUES ('approve', 'place', 'owner', 'approve', 'owner', 1)`),
    db.prepare("INSERT INTO terms_versions VALUES ('terms', 'business', 1, 'Provider Legal', 'Terms', 'es', 'Consent', 'hash')"),
    db.prepare("INSERT INTO quotes VALUES ('quote', 'job')"),
    db.prepare(`INSERT INTO quote_versions (id, quote_id, job_id, business_id, no, author_id, terms_id, original_locale,
      scope, exclusions, net_minor, tax_minor, total_minor, currency, state)
      VALUES ('quote-v1', 'quote', 'job', 'business', 1, 'foreman', 'terms', 'es', 'Door', '', 100, 20, 120, 'EUR', 'draft')`),
    db.prepare(`INSERT INTO quote_items (version_id, line_no, original_label, quantity, net_minor, tax_minor, evidence_rule)
      VALUES ('quote-v1', 1, 'Door', 1, 100, 20, 'Photo')`),
    db.prepare("UPDATE quote_versions SET publisher_id = 'foreman', issued_at = 2, expires_at = 8, state = 'issued' WHERE id = 'quote-v1'"),
    db.prepare(`INSERT INTO approvals (id, quote_version_id, account_id, grant_id, terms_hash, decision, at)
      VALUES ('approval', 'quote-v1', 'owner', 'approve', 'hash', 'approve', 3)`),
    db.prepare("UPDATE quote_versions SET state = 'approved' WHERE id = 'quote-v1'"),
    completion("first", 1),
    db.prepare(`INSERT INTO completion_items (id, completion_id, quote_version_id, line_no, outcome, original_language, result_note)
      VALUES ('first-item', 'first', 'quote-v1', 1, 'done', 'es', 'Works')`),
    db.prepare("UPDATE completions SET state = 'superseded' WHERE id = 'first'"),
    completion("second", 2),
    db.prepare(`INSERT INTO problem_cases (id, job_id, reference, reporter_id, case_owner_id, category, state,
      opened_at, acknowledge_by, first_update_by, next_update_at) VALUES
      ('case-one', 'job', 'BB-ONE', 'owner', 'foreman', 'quality', 'open', 15, 20, 25, 20),
      ('case-two', 'job', 'BB-TWO', 'owner', 'foreman', 'damage', 'open', 15, 20, 25, 20)`),
    db.prepare(`INSERT INTO case_events (id, case_id, job_id, actor_id, kind, audience, original_text, original_language, at)
      VALUES ('report', 'case-one', 'job', 'owner', 'reported', 'reporter_and_owner', 'The door sticks', 'en', 15)`),
    db.prepare("INSERT INTO media_stages VALUES ('stage', 'reader', 'case', 'case-one', 13, 120)"),
    db.prepare(`INSERT INTO attachments (id, stage_id, object_key, mime, bytes, state, retention_class)
      VALUES ('photo', 'stage', 'private/photo', 'image/jpeg', 123, 'reserved', 'unlinked')`),
    db.prepare("UPDATE attachments SET state = 'uploading' WHERE id = 'photo'"),
    db.prepare("UPDATE attachments SET state = 'verifying', lease_until = 40 WHERE id = 'photo'"),
    db.prepare("UPDATE attachments SET state = 'ready', lease_until = NULL, etag = 'received' WHERE id = 'photo'"),
  ]);
  const linkCompletion = db.prepare(`INSERT INTO completion_attachments (completion_id, completion_item_id, attachment_id)
    VALUES (?, 'first-item', 'photo')`);
  const linkCase = db.prepare("INSERT INTO case_attachments VALUES (?, 'report', 'photo')");
  await expect(linkCompletion.bind("second").run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
  await expect(linkCase.bind("case-two").run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
  await db.batch([linkCompletion.bind("first"), linkCase.bind("case-one")]);
  await expect(db.prepare("UPDATE attachments SET object_key = 'private/replaced' WHERE id = 'photo'").run()).rejects.toThrow(/settled object/);
}));

test("chat accepts at most eight queued operations and never replaces the original with a translation", () => {
  const operation = (n: number) => ({
    operationId: `op-${n}`, payload: { id: `message-${n}`, sourceLanguage: "es", originalText: "Hola" },
  });
  const input = (count: number) => ({ params: { id: "thread" }, body: { operations: Array.from({ length: count }, (_, n) => operation(n)) } });
  expect(appendThreadEntriesRoute.input.safeParse(input(8)).success).toBe(true);
  expect(appendThreadEntriesRoute.input.safeParse(input(9)).success).toBe(false);
  const entry = {
    id: "message", rootId: "message", revision: 1, position: 1, correctsId: null, receivedAt: 1, attachments: [],
    author: { displayName: "Sender", role: "foreman", isViewer: false }, sourceLanguage: "es", originalText: "Hola",
  };
  for (const preferredTranslation of [
    { state: "ready", targetLocale: "en", text: "Hello", producedAt: 2 },
    { state: "pending", targetLocale: "en" },
    { state: "unavailable", targetLocale: "en", canRetry: false },
  ]) expect(chatEntryProjectionSchema.parse({ ...entry, preferredTranslation }).originalText).toBe("Hola");
  expect(chatEntryProjectionSchema.safeParse({ ...entry, originalText: null,
    preferredTranslation: { state: "ready", targetLocale: "en", text: "Hello", producedAt: 2 } }).success).toBe(false);
});

test("media contracts enforce conditional PUT and batch distinct missing and completed parts", () => {
  const url = "https://private.example.test/upload";
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" };
  const put = { kind: "single", method: "PUT", expiresAt: 100, url };
  expect(mediaUploadGrantSchema.safeParse({ ...put, headers }).success).toBe(false);
  expect(mediaUploadGrantSchema.safeParse({ ...put, headers: { ...headers, "If-None-Match": "*" } }).success).toBe(true);
  const refresh = (missingPartNumbers: number[]) => ({ body: {
    stageId: "stage", scope: { caller: "chat", parentScopeId: "thread" }, files: [{
      attachmentId: "photo", file: { kind: "photo", mime: "image/jpeg", bytes: 100 },
      refresh: { uploadGeneration: 3, missingPartNumbers },
    }],
  } });
  expect(createMediaGrantsRoute.input.safeParse(refresh([1, 2])).success).toBe(true);
  expect(createMediaGrantsRoute.input.safeParse(refresh([2, 2])).success).toBe(false);
  const settle = (partNumbers: number[]) => ({ body: {
    stageId: "stage", files: [{ attachmentId: "photo", uploadGeneration: 3, kind: "multipart",
      parts: partNumbers.map((partNumber) => ({ partNumber, etag: '"received"' })),
    }, { attachmentId: "single", uploadGeneration: 1, kind: "single" }],
  } });
  expect(settleMediaRoute.input.safeParse(settle([1, 2])).success).toBe(true);
  expect(settleMediaRoute.input.safeParse(settle([1, 1])).success).toBe(false);
});

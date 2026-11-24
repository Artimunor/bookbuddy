import { mediaFileSchema, mediaLimits } from "@bookbuddy/api-contract";
import type { ChatAppendOperation, ErrorBody, OperationId } from "@bookbuddy/api-contract";
import { looksLikeAccessCode } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult } from "../../db/operations";
import { languageSql, translationText, unsupportedMessageControls } from "../../providers/translate";
import type { LanguagePair } from "../../providers/translate";
import { at, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { chatNotifications } from "./links";
import { chatParticipants, chatScope, chatTargets, ensureChatMember, entryVisible, exactThread } from "./policy";
import { canRetryTranslation, preferredTranslation, reviewedPair, translationIntent } from "./translation";

export const chatThreadKind = "chat_thread";
const photoMimes = mediaFileSchema.options[0].shape.mime.options.map((mime) => `'${mime}'`).join(", ");
const voiceMimes = mediaFileSchema.options[1].shape.mime.options.map((mime) => `'${mime}'`).join(", ");
export const mediaKind = (alias: string) => `CASE WHEN ${alias}.mime IN (${voiceMimes}) THEN 'voice' ELSE 'photo' END`;
export const chatMediaAvailable = (alias: string) => `${alias}.state = 'ready' AND (${alias}.delete_after IS NULL OR ${alias}.delete_after > ${at})`;
const hasThread = { sql: "EXISTS (SELECT 1 FROM chat_scope)" };

type Clock = { now: number };
type ChatReadInput = { operationId: OperationId; payload: { position: number } };
type TranslationCommandInput = { operationId: OperationId; payload: { targetLocale: string } };

function threadChanges(threadId: string, now: number, viewer?: SessionAccess): CommandStatement {
  if (viewer) return scopedStatement(viewer, `SELECT '${chatThreadKind}' AS kind, id AS resource_id,
    context_id AS partition_key, 'upsert' AS op, ${at} AS at FROM chat_scope`);
  return { sql: `WITH clock(at) AS (VALUES (?)), chat_targets AS MATERIALIZED (${chatTargets("t.id = ?")})
    SELECT '${chatThreadKind}' AS kind, id AS resource_id, context_id AS partition_key, 'upsert' AS op, ${at} AS at
    FROM (${chatParticipants()})`, params: [now, threadId] };
}

function joinSelects(a: CommandStatement, b: CommandStatement): CommandStatement {
  return { sql: `SELECT * FROM (${a.sql}) UNION ALL SELECT * FROM (${b.sql})`, params: [...a.params ?? [], ...b.params ?? []] };
}

export const receiptFields = (entry: string) => `'id', ${entry}.id, 'rootId', ${entry}.root_id,
  'revision', ${entry}.revision, 'position', ${entry}.position, 'receivedAt', ${entry}.received_at`;

export function readingLocales(entry: string, author: string): string {
  return `(SELECT json_group_array(reading_locale) FROM (
    SELECT DISTINCT p.reading_locale FROM all_chat_members reader JOIN account_preferences p ON p.account_id = reader.account_id
    WHERE ${entryVisible("reader", entry)} AND reader.account_id <> ${author} AND p.reading_locale IS NOT NULL
    ORDER BY p.reading_locale))`;
}

export function appendReceipts(session: SessionAccess, now: number, threadId: string, entryIds: readonly string[]): CommandStatement {
  return scopedStatement(chatScope(session, now, exactThread(threadId)), `, all_chat_members AS MATERIALIZED (${chatParticipants()})
    SELECT e.id, json_object(${receiptFields("e")}, 'readingLocales', json(${readingLocales("e", "scope.account_id")})) AS value
    FROM chat_scope scope JOIN chat_entries e ON ${entryVisible("scope", "e")}
    JOIN chat_messages m ON m.id = e.root_id AND m.author_context_id = scope.context_id
    WHERE e.id IN (SELECT value FROM json_each(?))`, JSON.stringify(entryIds));
}

export async function planChatAppend(ctx: Clock, session: SessionAccess, threadId: string, input: ChatAppendOperation,
  pairs: readonly LanguagePair[]): Promise<CommandInput<OperationResult>> {
  const { operationId, expectedRevision, payload } = input;
  const { id, correctsId, originalText, sourceLanguage } = payload;
  const attachments = [...(payload.attachmentIds ?? [])].sort();
  const linked = JSON.stringify(attachments);
  const original = originalText ?? null;
  const validText = original === null || (!unsupportedMessageControls.test(original) && !looksLikeAccessCode(original, "label-only"));
  const translate = validText && original !== null && translationText(original) !== null && pairs.length > 0;
  const scoped = chatScope(session, ctx.now, exactThread(threadId));
  const access: SessionAccess = { sql: `${scoped.sql}, append_input(id, corrects_id, original_text, source_language, attachments) AS (
      VALUES (?, ?, ?, ?, ?)), prior AS MATERIALIZED (
      SELECT e.* FROM chat_scope acc JOIN chat_entries e ON ${entryVisible("acc", "e")}
      JOIN chat_messages m ON m.id = e.root_id AND m.author_context_id = acc.context_id
      WHERE e.id = (SELECT corrects_id FROM append_input)
      AND NOT EXISTS (SELECT 1 FROM chat_entries newer WHERE newer.root_id = e.root_id AND newer.revision > e.revision))`,
    params: [...scoped.params, id, correctsId ?? null, original, sourceLanguage, linked] };
  const authorize = { sql: `EXISTS (SELECT 1 FROM chat_scope acc WHERE NOT EXISTS (
    SELECT 1 FROM chat_entries e JOIN chat_messages m ON m.id = e.root_id AND m.author_context_id = acc.context_id
    WHERE e.id = (SELECT id FROM append_input) AND e.thread_id = acc.id AND NOT (${entryVisible("acc", "e")})))` };
  const attached = `FROM attachments a JOIN media_stages stage ON stage.id = a.stage_id
    JOIN chat_scope acc ON stage.parent_scope_id = acc.id AND stage.context_id = acc.context_id
    WHERE stage.caller = 'chat' AND stage.created_at <= ${at} AND stage.expires_at > ${at} AND ${chatMediaAvailable("a")}
    AND a.id IN (SELECT value FROM append_input, json_each(attachments))`;
  const validAttachments = attachments.length === 0 ? "1" : `(SELECT count(*) ${attached} AND (
    (a.mime IN (${photoMimes}) AND a.bytes <= ${mediaLimits.photoBytes} AND a.duration_ms IS NULL)
    ${attachments.length === 1 ? `OR (a.mime IN (${voiceMimes}) AND a.bytes <= ${mediaLimits.voiceBytes}
      AND a.duration_ms BETWEEN 1 AND ${mediaLimits.voiceDurationMs})` : ""})) = ${attachments.length}`;
  const hasPrior = correctsId === undefined ? (expectedRevision === undefined || expectedRevision === 0
    ? "NOT EXISTS (SELECT 1 FROM chat_messages WHERE id = (SELECT id FROM append_input))" : "0")
    : `EXISTS (SELECT 1 FROM prior${expectedRevision === undefined ? "" : " WHERE revision = ?"})`;
  const notices = chatNotifications(scoped, threadId, id, ctx.now);
  const plan = await planOperation(ctx, {
    command: "chat.append", operationId, resultRef: id, access,
    input: { threadId, expectedRevision, payload: { id, correctsId, originalText, sourceLanguage, attachmentIds: attachments } },
    authorize,
    eligible: validText ? { sql: `EXISTS (SELECT 1 FROM chat_scope WHERE can_send) AND ${validAttachments}
      AND NOT EXISTS (SELECT 1 FROM chat_entries WHERE id = (SELECT id FROM append_input)) AND ${hasPrior}`,
      params: correctsId !== undefined && expectedRevision !== undefined ? [expectedRevision] : [] } : { sql: "0" },
    unchanged: { sql: `EXISTS (SELECT 1 FROM append_input i JOIN chat_entries e ON e.id = i.id
      JOIN chat_scope acc ON ${entryVisible("acc", "e")}
      JOIN chat_messages m ON m.id = e.root_id AND m.author_context_id = acc.context_id
      WHERE e.corrects_id IS i.corrects_id AND e.original_text IS i.original_text AND e.source_language = i.source_language
        AND (SELECT count(*) FROM entry_attachments WHERE entry_id = e.id) = json_array_length(i.attachments)
        AND NOT EXISTS (SELECT attachment_id FROM entry_attachments WHERE entry_id = e.id
          EXCEPT SELECT value FROM json_each(i.attachments)))` },
    ineligible: { code: validText ? "CONFLICT" : "VALIDATION_FAILED" },
    writes: (guard) => ({
      statements: [
        ...correctsId === undefined ? [
          ensureChatMember(scoped, guard),
          scopedStatement(scoped, `INSERT INTO chat_messages(id, thread_id, author_context_id)
            SELECT ?, id, context_id FROM chat_scope WHERE ${guard.sql}`, id, ...guard.params ?? []),
        ] : [],
        { sql: `UPDATE chat_threads SET last_position = last_position + 1 WHERE id = ? AND ${guard.sql}`,
          params: [threadId, ...guard.params ?? []] },
        { sql: `INSERT INTO chat_entries(id, root_id, thread_id, revision, position, corrects_id, source_language, original_text, received_at)
          SELECT ?, ${correctsId === undefined ? "?" : "prior.root_id"}, t.id, ${correctsId === undefined ? "1" : "prior.revision + 1"},
            t.last_position, ?, ?, ?, ? FROM chat_threads t ${correctsId === undefined ? "" : "JOIN chat_entries prior ON prior.id = ?"}
          WHERE t.id = ? AND ${guard.sql}`,
          params: [id, ...correctsId === undefined ? [id] : [], correctsId ?? null, sourceLanguage, original, ctx.now,
            ...correctsId === undefined ? [] : [correctsId], threadId, ...guard.params ?? []] },
        ...attachments.length ? [{
          sql: `INSERT INTO entry_attachments(entry_id, attachment_id) SELECT ?, value FROM json_each(?) WHERE ${guard.sql}`,
          params: [id, linked, ...guard.params ?? []],
        }, {
          sql: `UPDATE attachments SET retention_class = 'ordinary', delete_after = NULL
            WHERE id IN (SELECT value FROM json_each(?)) AND retention_class = 'unlinked' AND ${guard.sql}`,
          params: [linked, ...guard.params ?? []],
        }] : [],
        ...translate ? [scopedStatement(scoped, `, all_chat_members AS MATERIALIZED (${chatParticipants()})
          INSERT INTO message_translations(root_id, revision, target_locale, source_locale, state)
          SELECT DISTINCT e.root_id, e.revision, pair.value ->> '$[1]', e.source_language, 'pending'
          FROM chat_entries e JOIN chat_scope sender ON sender.id = e.thread_id
          JOIN all_chat_members r ON ${entryVisible("r", "e")} AND r.account_id <> sender.account_id
          JOIN account_preferences prefs ON prefs.account_id = r.account_id JOIN json_each(?) pair
            ON (pair.value ->> '$[0]') = e.source_language COLLATE NOCASE
            AND (pair.value ->> '$[1]') = prefs.reading_locale COLLATE NOCASE
          WHERE e.id = ? AND ${languageSql("e.source_language")} <> ${languageSql("prefs.reading_locale")} AND ${guard.sql}
          ON CONFLICT(root_id, revision, target_locale) DO NOTHING`, JSON.stringify(pairs), id, ...guard.params ?? [])] : [],
        ...notices.statements(guard),
      ],
      changes: joinSelects(threadChanges(threadId, ctx.now), notices.changes),
      effects: translate ? joinSelects(translationIntent(id, ctx.now), notices.effects) : notices.effects,
      topics: [{ kind: "thread", opaqueId: threadId }],
    }),
  });
  return { statements: plan.statements, decode(results) {
    const result = plan.decode(results);
    return result.outcome.status === "unchanged"
      ? { ...result, outcome: { operationId, status: "replayed", resultRef: id } } : result;
  } };
}

export function invalidSyncAppend(operationId: OperationId): CommandInput<OperationResult> {
  return { statements: [{ sql: "SELECT 1 WHERE 0" }], decode: () => ({
    outcome: { operationId, status: "rejected", error: { code: "VALIDATION_FAILED" } }, workKeys: [], topics: [],
  }) };
}


export const savedReadPosition = (thread: string) => `coalesce((SELECT position FROM thread_reads r
  WHERE r.thread_id = ${thread}.id AND r.context_id = ${thread}.context_id), 0)`;

export async function planChatReadMark(ctx: Clock, session: SessionAccess, threadId: string,
  input: ChatReadInput): Promise<CommandInput<OperationResult>> {
  const { operationId, payload: { position } } = input;
  const scoped = chatScope(session, ctx.now, exactThread(threadId));
  return planOperation(ctx, {
    command: "chat.read_position", operationId, resultRef: threadId, access: scoped, input: { threadId, position },
    authorize: hasThread,
    eligible: { sql: `EXISTS (SELECT 1 FROM chat_scope acc WHERE ? > ${savedReadPosition("acc")} AND ? <= acc.last_position)`,
      params: [position, position] },
    unchanged: { sql: `EXISTS (SELECT 1 FROM chat_scope acc WHERE ? <= ${savedReadPosition("acc")} AND ? <= acc.last_position)`,
      params: [position, position] },
    writes: (guard) => ({
      statements: [ensureChatMember(scoped, guard), scopedStatement(scoped, `INSERT INTO thread_reads(thread_id, context_id, position)
        SELECT id, context_id, ? FROM chat_scope WHERE ${guard.sql}
        ON CONFLICT(thread_id, context_id) DO UPDATE SET position = excluded.position`, position, ...guard.params ?? [])],
      changes: threadChanges(threadId, ctx.now, scoped),
    }),
  });
}

export function readMarkResult(session: SessionAccess, now: number, threadId: string): CommandStatement {
  return scopedStatement(chatScope(session, now, exactThread(threadId)), `SELECT json_object('threadId', id,
    'position', ${savedReadPosition("acc")}) AS value FROM chat_scope acc`);
}

function translationAccess(session: SessionAccess, now: number, entryId: string, targetLocale: string) {
  const scoped = chatScope(session, now, { sql: "t.id = (SELECT thread_id FROM chat_entries WHERE id = ?)", params: [entryId] });
  return { sql: `${scoped.sql}, picked_translation AS MATERIALIZED (
    SELECT e.*, mt.target_locale, mt.state, mt.translated_text, mt.produced_at, acc.context_id
    FROM chat_scope acc JOIN chat_entries e ON ${entryVisible("acc", "e")}
    JOIN account_preferences prefs ON prefs.account_id = acc.account_id
    JOIN message_translations mt ON mt.root_id = e.root_id AND mt.revision = e.revision AND mt.target_locale = prefs.reading_locale COLLATE NOCASE
    WHERE e.id = ? AND mt.target_locale = ? COLLATE NOCASE AND e.original_text IS NOT NULL)`,
    params: [...scoped.params, entryId, targetLocale] } satisfies SessionAccess;
}

export type CommandValue = { operation: OperationResult; value: string | null; error: ErrorBody | null };
export function withChatValue(plan: CommandInput<OperationResult>, statement: CommandStatement): CommandInput<CommandValue> {
  return { statements: [...plan.statements, statement], decode(results) {
    const operation = plan.decode(results.slice(0, -1));
    const row = results.at(-1)?.results[0] as { value: string } | undefined;
    return { operation, value: row?.value ?? null,
      error: operation.outcome.status === "rejected" ? operation.outcome.error : null };
  } };
}

const hasTranslation = { sql: "EXISTS (SELECT 1 FROM picked_translation)" };
export async function planTranslationReport(ctx: Clock, session: SessionAccess, entryId: string, input: TranslationCommandInput) {
  const { operationId, payload: { targetLocale } } = input;
  const access = translationAccess(session, ctx.now, entryId, targetLocale);
  const plan = await planOperation(ctx, {
    command: "chat.report_translation", operationId, resultRef: entryId, access, input: { entryId, targetLocale },
    authorize: hasTranslation,
    eligible: { sql: `EXISTS (SELECT 1 FROM picked_translation picked WHERE state = 'ready' AND NOT EXISTS (
      SELECT 1 FROM translation_reports r WHERE r.entry_id = picked.id AND r.context_id = picked.context_id))` },
    unchanged: { sql: `EXISTS (SELECT 1 FROM picked_translation p JOIN translation_reports r
      ON r.entry_id = p.id AND r.context_id = p.context_id AND r.target_locale = p.target_locale)` },
    writes: (guard) => ({ statements: [scopedStatement(access, `INSERT INTO translation_reports(entry_id, context_id, target_locale, reported_at)
      SELECT id, context_id, target_locale, ${at} FROM picked_translation WHERE ${guard.sql}`, ...guard.params ?? [])] }),
  });
  return withChatValue(plan, scopedStatement(access, `SELECT json_object('entryId', p.id, 'targetLocale', r.target_locale,
    'reportedAt', r.reported_at) AS value FROM picked_translation p JOIN translation_reports r
    ON r.entry_id = p.id AND r.context_id = p.context_id AND r.target_locale = p.target_locale`));
}

export async function planTranslationRetry(ctx: Clock, session: SessionAccess, entryId: string, input: TranslationCommandInput, pairs: readonly LanguagePair[]) {
  const { operationId, payload: { targetLocale } } = input;
  const access = translationAccess(session, ctx.now, entryId, targetLocale);
  const plan = await planOperation(ctx, {
    command: "chat.request_translation", operationId, resultRef: entryId, access, input: { entryId, targetLocale },
    authorize: hasTranslation,
    eligible: { sql: `EXISTS (SELECT 1 FROM picked_translation p WHERE p.state = 'unavailable'
      AND ${canRetryTranslation("p.id", "p.target_locale")} AND ${reviewedPair("p.source_language", "p.target_locale", "?")})`,
      params: [JSON.stringify(pairs)] },
    writes: (guard) => ({
      statements: [scopedStatement(access, `UPDATE message_translations SET state = 'pending', provider = NULL, model = NULL
        WHERE (root_id, revision, target_locale) IN (SELECT root_id, revision, target_locale FROM picked_translation) AND ${guard.sql}`,
        ...guard.params ?? [])],
      effects: translationIntent(entryId, ctx.now, { operation: `retry-${crypto.randomUUID()}`, target: targetLocale }),
    }),
  });
  return withChatValue(plan, scopedStatement(access, `, translation_config(pairs) AS (VALUES (?))
    SELECT json_object('entryId', p.id, 'preferredTranslation', json(${preferredTranslation("p", "p.target_locale", "p", pairs)})) AS value
    FROM picked_translation p`, JSON.stringify(pairs)));
}

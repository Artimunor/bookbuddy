import type { CommandStatement } from "../../db/commit";
import { languageSql } from "../../providers/translate";
import type { LanguagePair } from "../../providers/translate";

export const translationEffectKind = "chat_translation";
export const translationWorkLifetime = 24 * 60 * 60 * 1000;
const keyPrefix = (entry: string, locale: string) => `'chat-translation:' || ${entry} || ':' || lower(${locale}) || ':'`;

// Entry ID is the immutable, unique reference for (root ID, revision). Each
// attempt retains its own ledger row. Only an explicit, guarded retry adds one.
export const latestTranslationWork = (entry: string, locale: string) => `(SELECT ledger.state FROM effect_outbox ledger
  WHERE ledger.dedupe_key >= (${keyPrefix(entry, locale)}) AND ledger.dedupe_key < (${keyPrefix(entry, locale)} || '~')
  ORDER BY ledger.rowid DESC LIMIT 1)`;

export const canRetryTranslation = (entry: string, locale: string) =>
  `coalesce(${latestTranslationWork(entry, locale)} = 'failed', 0)`;

export const reviewedPair = (source: string, target: string, pairs: string) => `EXISTS (
  SELECT 1 FROM json_each(${pairs}) pair WHERE (pair.value ->> '$[0]') = ${source} COLLATE NOCASE
    AND (pair.value ->> '$[1]') = ${target} COLLATE NOCASE)`;

export function translationIntent(entryId: string, now: number, retry?: { operation: string; target: string }): CommandStatement {
  return { sql: `SELECT lower(hex(randomblob(16))) AS id, '${translationEffectKind}' AS kind,
      ${keyPrefix("ce.id", "mt.target_locale")} || ? AS dedupe_key, json_array(ce.id, mt.target_locale) AS resource_ref,
      ? AS due_at, ? AS expires_at
    FROM chat_entries ce JOIN message_translations mt ON mt.root_id = ce.root_id AND mt.revision = ce.revision
    WHERE ce.id = ? AND mt.state = 'pending'${retry ? " AND mt.target_locale = ? COLLATE NOCASE" : ""}`,
    params: [retry?.operation ?? "initial", now, now + translationWorkLifetime, entryId, ...(retry ? [retry.target] : [])] };
}

export function preferredTranslation(entry: string, target: string, stored: string, pairs: readonly LanguagePair[], preview = false) {
  return `CASE WHEN ${entry}.original_text IS NULL OR ${entry}.source_language IS NULL OR ${target} IS NULL
    OR ${languageSql(`${entry}.source_language`)} = ${languageSql(target)} THEN NULL
    WHEN ${stored}.state = 'ready' THEN json_object('state', 'ready', 'targetLocale', ${stored}.target_locale,
      'text', ${preview ? `substr(${stored}.translated_text, 1, 256)` : `${stored}.translated_text`}, 'producedAt', ${stored}.produced_at)
    WHEN ${stored}.state = 'pending' THEN json_object('state', 'pending', 'targetLocale', ${stored}.target_locale)
    ELSE json_object('state', 'unavailable', 'targetLocale', coalesce(${stored}.target_locale, ${target}), 'canRetry',
      json(CASE WHEN ${stored}.state = 'unavailable' AND ${canRetryTranslation(`${entry}.id`, target)}
        AND ${pairs.length ? reviewedPair(`${entry}.source_language`, target, "(SELECT pairs FROM translation_config)") : "0"}
      THEN 'true' ELSE 'false' END)) END`;
}

export const bindTranslation = (entry: string, locale: string, alias = "mt") =>
  `LEFT JOIN message_translations ${alias} ON ${alias}.root_id = ${entry}.root_id AND ${alias}.revision = ${entry}.revision
      AND lower(${alias}.target_locale) = lower(${locale})`;

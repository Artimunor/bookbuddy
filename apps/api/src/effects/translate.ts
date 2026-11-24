import type { Bindings } from "../bindings";
import { at } from "../modules/access/policy";
import { chatParticipants, chatTargets, entryVisible } from "../modules/chat/policy";
import { latestTranslationWork, translationEffectKind } from "../modules/chat/translation";
import {
  createGoogleTranslation, enabledTranslationPairs, translationMaxBytes, translationMaxCharacters, translationMaxTexts,
  translationModel, translationProvider, translationText, translationTextBytes,
} from "../providers/translate";
import type { LanguagePair, TranslationFetch } from "../providers/translate";
import { publishLiveTopics } from "../realtime/topics";
import type { ClaimedEffect } from ".";
import type { EffectOutcome } from "./push";

const entryRef = `CASE WHEN e.kind = '${translationEffectKind}' THEN e.resource_ref ->> '$[0]' END`;
const targetRef = `CASE WHEN e.kind = '${translationEffectKind}' THEN e.resource_ref ->> '$[1]' END`;
const content = `FROM chat_entries ce JOIN message_translations mt ON mt.root_id = ce.root_id AND mt.revision = ce.revision
  AND mt.target_locale = (${targetRef}) JOIN chat_messages root ON root.id = ce.root_id
  JOIN account_contexts author ON author.id = root.author_context_id
  WHERE ce.id = (${entryRef}) AND mt.state = 'pending' AND ce.original_text IS NOT NULL`;

export const chatTranslationEffect = {
  kind: translationEffectKind,
  eligible: `EXISTS (SELECT 1 ${content} AND EXISTS (
    WITH chat_targets AS MATERIALIZED (${chatTargets("t.id = ce.thread_id")})
    SELECT 1 FROM (${chatParticipants()}) reader JOIN account_preferences p ON p.account_id = reader.account_id
    WHERE ${entryVisible("reader", "ce")} AND reader.account_id <> author.account_id
      AND p.reading_locale = mt.target_locale COLLATE NOCASE))`,
  scrub: "resource_ref", // Ledger references are immutable entry ID and target only.
  claimResource: `(SELECT json_object('source', mt.source_locale, 'target', mt.target_locale, 'text', ce.original_text,
    'names', json((SELECT json_group_array(name) FROM (
      SELECT DISTINCT substr(a.display_name, 1, 128) AS name FROM accounts a WHERE a.display_name IS NOT NULL AND (
        a.id = author.account_id OR a.id = (SELECT j.requester_id FROM chat_threads t JOIN jobs j ON j.id = t.job_id WHERE t.id = ce.thread_id)
        OR a.id IN (SELECT c.account_id FROM chat_members cm JOIN account_contexts c ON c.id = cm.context_id
          WHERE cm.thread_id = ce.thread_id)
        OR a.id IN (WITH chat_targets AS MATERIALIZED (${chatTargets("t.id = ce.thread_id")})
          SELECT account_id FROM (${chatParticipants()}))
        OR a.id IN (SELECT m.account_id FROM chat_threads t JOIN visits v ON v.job_id = t.job_id
          JOIN shifts s ON s.visit_id = v.id JOIN shift_slots slot ON slot.shift_id = s.id
          JOIN assignments assignment ON assignment.slot_id = slot.id
          JOIN memberships m ON m.id = assignment.worker_membership_id WHERE t.id = ce.thread_id)
      ) LIMIT 129)))) ${content})`,
};

export interface TranslationThread { thread_id: string }

// The shared consumer may expire undispatched rows or fence a timed-out
// claimant before dispatch. Project those terminal outcomes in the claim batch,
// including when no new effect was claimed. Never reopen a lease here.
export function recoverTranslations(db: D1Database, target: string, keyArgs: readonly string[], limit: number) {
  return db.prepare(`WITH terminal AS MATERIALIZED (
      SELECT ce.root_id, ce.revision, mt.target_locale FROM effect_outbox e
      JOIN chat_entries ce ON ce.id = (${entryRef})
      JOIN message_translations mt ON mt.root_id = ce.root_id AND mt.revision = ce.revision AND mt.target_locale = (${targetRef})
      WHERE e.kind = '${translationEffectKind}' AND ${target} AND e.state IN ('skipped', 'unknown')
        AND mt.state = 'pending' AND ${latestTranslationWork("ce.id", "mt.target_locale")} = e.state
      ORDER BY e.due_at, e.id LIMIT ${limit})
    UPDATE message_translations SET state = 'unavailable'
    WHERE (root_id, revision, target_locale) IN (SELECT root_id, revision, target_locale FROM terminal)
    RETURNING (SELECT thread_id FROM chat_entries ce
      WHERE ce.root_id = message_translations.root_id AND ce.revision = message_translations.revision) AS thread_id`).bind(...keyArgs);
}

interface TranslationInput { source: string; target: string; text: string; names: string[] }
interface Item { id: string; text: string; bytes: number }
interface Result extends EffectOutcome { text?: string; provider?: string; model?: string }

export async function dispatchTranslation(env: Bindings, jobs: readonly ClaimedEffect[], claim: string, fetcher?: TranslationFetch): Promise<{
  outcomes: EffectOutcome[]; statement: D1PreparedStatement | null;
}> {
  if (jobs.length === 0) return { outcomes: [], statement: null };
  const credential = env.GOOGLE_TRANSLATION_CREDENTIAL?.trim();
  const provider = credential ? createGoogleTranslation(env, fetcher) : null;
  const pairs = new Map(enabledTranslationPairs(env).map((pair) => [pairKey(...pair), pair]));
  const groups = new Map<LanguagePair, Item[]>();
  const outcomes: Result[] = [];
  for (const job of jobs) {
    if (!job.resource_ref) { outcomes.push({ id: job.id, state: "skipped" }); continue; }
    const { source, target, text: original, names } = JSON.parse(job.resource_ref) as TranslationInput;
    const pair = pairs.get(pairKey(source, target));
    const text = pair && names.length <= 128 ? translationText(original, names) : null;
    if (!pair || !text) { outcomes.push({ id: job.id, state: "skipped" }); continue; }
    if (!provider || !credential) { outcomes.push({ id: job.id, state: "failed" }); continue; }
    const bytes = translationTextBytes(text);
    if (text.length > translationMaxCharacters || bytes > translationMaxBytes) {
      outcomes.push({ id: job.id, state: "skipped" }); continue;
    }
    const list = groups.get(pair);
    const item = { id: job.id, text, bytes };
    if (list) list.push(item); else groups.set(pair, [item]);
  }
  if (provider && credential) {
    const batches: { pair: LanguagePair; items: Item[] }[] = [];
    for (const [pair, items] of groups) {
      let current: Item[] = [], bytes = 0, characters = 0;
      for (const item of items) {
        if (current.length === translationMaxTexts || bytes + item.bytes > translationMaxBytes || characters + item.text.length > translationMaxCharacters) {
          batches.push({ pair, items: current });
          current = [];
          bytes = characters = 0;
        }
        current.push(item);
        bytes += item.bytes;
        characters += item.text.length;
      }
      if (current.length) batches.push({ pair, items: current });
    }
    // A Worker can hold at most six outgoing connections in one invocation.
    // Read each response completely before opening the next group of calls.
    for (let offset = 0; offset < batches.length; offset += 4) {
      const settled = await Promise.all(batches.slice(offset, offset + 4).map(async ({ pair, items }) => {
        const result = await provider.translate(pair, items.map(({ text }) => text), credential);
        return items.map(({ id }, index): Result => result.state === "ready"
          ? { id, state: "delivered", text: result.texts[index]!, provider: translationProvider, model: translationModel }
          : { id, state: result.state === "uncharged" ? "failed" : "unknown", provider: translationProvider, model: translationModel });
      }));
      for (const batch of settled) outcomes.push(...batch);
    }
  }
  const statement = env.DB.prepare(`WITH results AS MATERIALIZED (
      SELECT ce.root_id, ce.revision, (${targetRef}) AS target_locale,
        item.value ->> 'text' AS text, item.value ->> 'provider' AS provider, item.value ->> 'model' AS model
      FROM json_each(?) item JOIN effect_claims c ON c.effect_id = item.value ->> 'id' AND c.claim_id = ? AND c.result_code IS NULL
      JOIN effect_outbox e ON e.id = c.effect_id AND e.state = 'claimed' AND e.kind = '${translationEffectKind}'
      JOIN chat_entries ce ON ce.id = (${entryRef}))
    UPDATE message_translations SET state = CASE WHEN results.text IS NULL THEN 'unavailable' ELSE 'ready' END,
      translated_text = results.text, provider = results.provider, model = results.model,
      produced_at = CASE WHEN results.text IS NOT NULL THEN ? END
    FROM results WHERE message_translations.root_id = results.root_id AND message_translations.revision = results.revision
      AND message_translations.target_locale = results.target_locale AND message_translations.state = 'pending'
    RETURNING (SELECT thread_id FROM chat_entries ce
      WHERE ce.root_id = message_translations.root_id AND ce.revision = message_translations.revision) AS thread_id`)
    .bind(JSON.stringify(outcomes), claim, Date.now());
  return { outcomes: outcomes.map(({ id, state }) => ({ id, state })), statement };
}

const pairKey = (source: string, target: string) => `${source.toLowerCase()}:${target.toLowerCase()}`;

export async function publishTranslationHints(env: Bindings, rows: readonly TranslationThread[]) {
  await Promise.allSettled(publishLiveTopics(env.LIVE, rows.map(({ thread_id }) => ({ kind: "thread", opaqueId: thread_id }))));
}

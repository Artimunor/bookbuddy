import { syncLimits, syncProjectionSchema } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import type { LanguagePair } from "../../providers/translate";
import { at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { customerStampSql } from "../field/live";
import { activeHold, currentSafetyVersion, effectiveAttendance } from "../field/safety";
import { currentMembership } from "../jobs/projections";
import type { SyncProjectionReader } from "../sync/registry";
import { chatMediaAvailable, chatThreadKind, mediaKind, readingLocales, receiptFields, savedReadPosition } from "./commands";
import { chatParticipants, chatScope, chatTargets, entryVisible, exactThread, threadPageFilter } from "./policy";
import { bindTranslation, preferredTranslation } from "./translation";

const entryPageSize = 16; // Bound a page of original and translated texts below D1's row size limit.
const inboxPageSize = syncLimits.changes;
const bool = (condition: string) => `json(CASE WHEN ${condition} THEN 'true' ELSE 'false' END)`;
const items = (select: string) => `(SELECT json_group_array(json(value)) FROM (${select}))`;
const threadFields = (t: string) => `'id', ${t}.id, 'audience', ${t}.audience,
  CASE WHEN ${t}.audience = 'session' THEN 'session' ELSE 'job' END,
  json_object('id', coalesce(${t}.job_id, ${t}.session_booking_id), 'reference', ${t}.reference, 'title', nullif(${t}.title, ''),
    'siteZone', coalesce(${t}.site_zone, (SELECT coalesce(p.site_zone, area.site_zone)
      FROM places p JOIN businesses b ON b.id = ${t}.business_id
      JOIN operating_areas area ON area.id = b.catchment_id WHERE p.id = ${t}.place_id))),
  'writeState', CASE WHEN NOT ${t}.parent_open THEN 'read_only' ELSE ${t}.write_state END`;
const actorFields = (account: string, context: string, viewer: string) => `'displayName', ${displayName(account)},
  'role', ${context}.role, 'isViewer', ${bool(`${context}.context_id = ${viewer}.context_id`)}`;
const contact = (member: string, viewer: string) => `CASE WHEN ${viewer}.role = 'foreman' THEN
  ${viewer}.audience <> 'crew' AND ${member}.role = 'customer' AND ${member}.account_id = ${viewer}.requester_id
  ELSE ${member}.role = 'foreman' END`;
const authorJoins = `JOIN chat_messages m ON m.id = e.root_id
  JOIN (SELECT id AS context_id, role, account_id FROM account_contexts) author ON author.context_id = m.author_context_id
  JOIN accounts person ON person.id = author.account_id`;

export function inboxCursor(cursor?: string): readonly [string, string] | null {
  if (cursor === undefined) return ["", ""];
  const match = /^([A-Za-z0-9_-]{1,256})~(job|crew|session)$/.exec(cursor);
  return match ? [match[1]!, match[2]!] : null;
}

export function entryCursor(cursor?: string): number | null | undefined {
  if (cursor === undefined) return null; // Newest first page; subsequent pages go back by position.
  const match = /^before~([1-9]\d*)$/.exec(cursor);
  const position = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(position) ? position : undefined;
}

export function readThreadList(session: SessionAccess, now: number, after: readonly [string, string], pairs: readonly LanguagePair[]) {
  const scope = chatScope(session, now, threadPageFilter(after));
  return scopedStatement(scope, `, translation_config(pairs) AS (VALUES (?)), list AS MATERIALIZED (
      SELECT *, coalesce(job_id, session_booking_id) AS parent_id FROM chat_scope ORDER BY parent_id, audience LIMIT ${inboxPageSize + 1}),
    all_chat_members AS MATERIALIZED (WITH inbox_targets AS (SELECT target.* FROM chat_targets target
      JOIN list page ON page.id = target.id) SELECT * FROM (${chatParticipants("1", "inbox_targets")}))
    SELECT (SELECT json_object('threads', json(${items(`SELECT json_object(${threadFields("t")},
      'contact', json((SELECT json_object(${actorFields("a", "member", "t")}) FROM all_chat_members member
        JOIN accounts a ON a.id = member.account_id WHERE member.id = t.id AND (${contact("member", "t")}) LIMIT 1)),
      'unreadCount', (SELECT count(*) FROM chat_entries unread JOIN chat_messages root ON root.id = unread.root_id
        WHERE ${entryVisible("t", "unread")} AND unread.position > ${savedReadPosition("t")} AND root.author_context_id <> t.context_id),
      'latest', json((SELECT json_object('sourceLanguage', e.source_language, 'originalText', substr(e.original_text, 1, 256),
        'preferredTranslation', json(${preferredTranslation("e", "pref.reading_locale", "mt", pairs, true)}),
        'author', json_object(${actorFields("person", "author", "t")}), 'receivedAt', e.received_at,
        'attachmentKind', (SELECT ${mediaKind("media")} FROM entry_attachments ea JOIN attachments media ON media.id = ea.attachment_id
          WHERE ea.entry_id = e.id ORDER BY media.id LIMIT 1))
        FROM chat_entries e ${authorJoins} ${bindTranslation("e", "pref.reading_locale")}
        WHERE ${entryVisible("t", "e")} ORDER BY e.position DESC LIMIT 1))) AS value
      FROM list t LEFT JOIN account_preferences pref ON pref.account_id = t.account_id
      ORDER BY t.parent_id, t.audience LIMIT ${inboxPageSize}`)}),
      'page', json_object('hasMore', ${bool(`(SELECT count(*) FROM list) > ${inboxPageSize}`)}, 'cursor',
        (SELECT parent_id || '~' || audience FROM list WHERE (SELECT count(*) FROM list) > ${inboxPageSize}
          ORDER BY parent_id, audience LIMIT 1 OFFSET ${inboxPageSize - 1}))) FROM live_scope) AS value FROM acting_session`, JSON.stringify(pairs));
}

const assignedVisibility = `(t.role = 'foreman' OR a.worker_membership_id = ${currentMembership("t", at)})`;
const crewHold = `(WITH relevant AS MATERIALIZED (
  SELECT v.id AS visit_id, a.id, a.starts_at FROM visits v
  JOIN shifts s ON s.visit_id = v.id AND s.state IN ('planned', 'active')
  JOIN shift_slots slot ON slot.shift_id = s.id JOIN assignments a ON a.slot_id = slot.id
  WHERE v.job_id = t.job_id AND v.state = 'booked' AND a.state = 'confirmed' AND a.confirmed_at <= ${at}
    AND a.ends_at > ${at} AND ${assignedVisibility}
) SELECT EXISTS (SELECT 1 FROM relevant r WHERE r.visit_id = (
  SELECT visit_id FROM relevant ORDER BY starts_at > ${at}, starts_at, visit_id LIMIT 1
) AND ${activeHold("r.id", currentSafetyVersion("r.id"))}))`;

const allChatMembers = `all_chat_members AS MATERIALIZED (${chatParticipants()})`;
const threadDetailsJson = `json_patch(json_object(${threadFields("t")}, 'canSend', ${bool("t.can_send")},
      'readOnlyReason', CASE WHEN NOT t.parent_open THEN CASE WHEN t.audience = 'session' THEN 'session_closed' ELSE 'job_closed' END
        WHEN NOT t.can_send THEN 'read_only_grant' END,
      'readPosition', ${savedReadPosition("t")}, 'lastPosition', t.last_position, 'readingLocale', pref.reading_locale,
      'members', json(${items(`SELECT json_object(${actorFields("a", "member", "t")}, 'isContact', ${bool(contact("member", "t"))},
        'writingLanguage', (SELECT e.source_language FROM chat_entries e JOIN chat_messages m ON m.id = e.root_id
          WHERE ${entryVisible("t", "e")} AND m.author_context_id = member.context_id AND e.source_language IS NOT NULL
          ORDER BY e.position DESC LIMIT 1), 'readingLocale', p.reading_locale) AS value
        FROM all_chat_members member JOIN accounts a ON a.id = member.account_id
        LEFT JOIN account_preferences p ON p.account_id = member.account_id
        ORDER BY member.role <> 'foreman', a.display_name, member.context_id`)})),
      CASE WHEN t.audience = 'crew' THEN json_object('safetyHold', ${bool(crewHold)}) ELSE '{}' END)`;
const threadDetailsSql = `(SELECT ${threadDetailsJson}
      FROM chat_scope t LEFT JOIN account_preferences pref ON pref.account_id = t.account_id)`;

export function readThread(session: SessionAccess, now: number, threadId: string): CommandStatement {
  return scopedStatement(chatScope(session, now, exactThread(threadId)), `,
    ${allChatMembers} SELECT ${threadDetailsSql} AS value FROM acting_session`);
}

const stampFloor = `max(t.visible_since, coalesce((SELECT received_at + 1 FROM chat_entries e
  WHERE e.thread_id = t.id AND e.position < t.visible_from ORDER BY e.position DESC LIMIT 1), t.visible_since))`;
const jobStamps = items(`SELECT json_object('visitId', v.id, 'update', json(${customerStampSql("cu", "b.public_name")}),
  'isCurrent', ${bool(`NOT EXISTS (SELECT 1 FROM customer_updates next WHERE next.visit_id = v.id AND next.recorded_at <= ${at}
    AND (next.recorded_at, next.rowid) > (cu.recorded_at, cu.rowid) AND (next.corrects_id = cu.id
      OR (cu.kind IN ('on_the_way', 'arrival_revised', 'arrival_withdrawn') AND next.kind IN ('on_site', 'arrival_revised', 'arrival_withdrawn', 'cover_arranging', 'on_the_way'))))`)}) AS value
  FROM visits v JOIN customer_updates cu ON cu.visit_id = v.id JOIN businesses b ON b.id = t.business_id
  WHERE v.job_id = t.job_id AND cu.recorded_at BETWEEN ${stampFloor} AND ${at}
    AND (cu.kind <> 'photo' OR EXISTS (SELECT 1 FROM update_attachments ua WHERE ua.update_id = cu.id))
  ORDER BY cu.recorded_at DESC, cu.id DESC LIMIT ${entryPageSize}`);

const crewStamps = items(`SELECT json_object('id', id, 'visitId', visit_id, 'at', stamp_at, 'kind', kind,
    'isCurrent', ${bool("current")}, 'actorName', (SELECT ${displayName("actor")} FROM accounts actor WHERE actor.id = actor_id)) AS value FROM (
    SELECT e.id, v.id AS visit_id, e.actual_at AS stamp_at, e.actor_id,
      CASE e.kind WHEN 'arrival' THEN 'checked_in' ELSE 'checked_out' END AS kind, ${effectiveAttendance("e")} AS current
    FROM visits v JOIN shifts s ON s.visit_id = v.id JOIN shift_slots slot ON slot.shift_id = s.id
    JOIN assignments a ON a.slot_id = slot.id JOIN attendance_events e ON e.assignment_id = a.id
    WHERE v.job_id = t.job_id AND ${assignedVisibility} AND e.review_state = 'accepted' AND e.received_at <= ${at}
    UNION ALL
    SELECT a.id, v.id, a.confirmed_at, a.confirmed_by, 'cover_confirmed', a.state = 'confirmed'
    FROM visits v JOIN shifts s ON s.visit_id = v.id JOIN shift_slots slot ON slot.shift_id = s.id
    JOIN assignments a ON a.slot_id = slot.id AND a.source = 'cover' WHERE v.job_id = t.job_id AND ${assignedVisibility}
    UNION ALL
    SELECT e.id, v.id, e.at, e.actor_id, e.kind, NOT EXISTS (SELECT 1 FROM visit_activity_events next
      WHERE next.visit_id = v.id AND next.kind IN ('work_started', 'work_paused', 'work_finished')
      AND (next.at, next.rowid) > (e.at, e.rowid) AND next.at <= ${at})
    FROM visits v JOIN visit_activity_events e ON e.visit_id = v.id LEFT JOIN assignments a ON a.id = e.assignment_id
    WHERE v.job_id = t.job_id AND (e.assignment_id IS NULL OR ${assignedVisibility})
      AND e.kind IN ('work_started', 'work_paused', 'work_finished')
  ) WHERE stamp_at BETWEEN ${stampFloor} AND ${at} ORDER BY stamp_at DESC, id DESC LIMIT ${entryPageSize}`);

const threadEntriesSql = (initial: boolean, pairs: readonly LanguagePair[], includeHeader = false) => `(SELECT
      json_object('threadId', t.id, 'audience', t.audience, ${includeHeader ? `'thread', json(${threadDetailsJson}),` : ""}
      'entries', json(${items(`SELECT CASE WHEN author.author_context = t.context_id THEN
        json_set(entry, '$.readingLocales', json(locales)) ELSE entry END AS value FROM (
        SELECT json_object(${receiptFields("e")}, 'correctsId', e.corrects_id, 'sourceLanguage', e.source_language,
          'originalText', e.original_text, 'preferredTranslation', json(${preferredTranslation("e", "pref.reading_locale", "mt", pairs)}),
          'author', json_object(${actorFields("person", "author", "t")}), 'attachments', json(${items(`SELECT
            json_object('attachmentId', a.id, 'kind', ${mediaKind("a")},
              'availability', CASE WHEN ${chatMediaAvailable("a")} THEN 'available' ELSE 'unavailable' END) AS value
              FROM entry_attachments ea JOIN attachments a ON a.id = ea.attachment_id WHERE ea.entry_id = e.id ORDER BY a.id`)})) AS entry,
          author.context_id AS author_context,
          CASE WHEN author.context_id = t.context_id THEN ${readingLocales("e", "t.account_id")} END AS locales
        FROM entries e ${authorJoins} ${bindTranslation("e", "pref.reading_locale")}
        ORDER BY e.position DESC LIMIT ${entryPageSize}) author`)}),
      'stamps', json(${initial ? `CASE t.audience WHEN 'job' THEN ${jobStamps} WHEN 'crew' THEN ${crewStamps} ELSE '[]' END` : "'[]'"}),
      'page', json_object('hasMore', ${bool(`(SELECT count(*) FROM entries) > ${entryPageSize}`)}, 'cursor',
        (SELECT 'before~' || position FROM entries WHERE (SELECT count(*) FROM entries) > ${entryPageSize}
          ORDER BY position DESC LIMIT 1 OFFSET ${entryPageSize - 1})))
      FROM chat_scope t LEFT JOIN account_preferences pref ON pref.account_id = t.account_id)`;

function threadEntriesScope(session: SessionAccess, now: number, threadId: string, before: number | null, pairs: readonly LanguagePair[]): SessionAccess {
  const scope = chatScope(session, now, exactThread(threadId));
  return {
    sql: `${scope.sql}, translation_config(pairs) AS (VALUES (?)),
      entries AS MATERIALIZED (SELECT e.* FROM chat_scope t JOIN chat_entries e ON ${entryVisible("t", "e")}
        ${before === null ? "" : " WHERE e.position < ?"} ORDER BY e.position DESC LIMIT ${entryPageSize + 1}),
      ${allChatMembers}`,
    params: [...scope.params, JSON.stringify(pairs), ...before === null ? [] : [before]],
  };
}

export function readThreadEntries(session: SessionAccess, now: number, threadId: string, before: number | null,
  pairs: readonly LanguagePair[]): CommandStatement {
  return scopedStatement(threadEntriesScope(session, now, threadId, before, pairs),
    `SELECT ${threadEntriesSql(before === null, pairs, before === null)} AS value FROM acting_session`);
}

export function readLiveThread(session: SessionAccess, now: number, threadId: string, pairs: readonly LanguagePair[]): CommandStatement {
  return scopedStatement(threadEntriesScope(session, now, threadId, null, pairs), `
    SELECT t.context_id AS scope_id, s.expires_at, CASE WHEN t.context_id IS NOT NULL THEN
      json_object('kind', 'thread_catch_up', 'at', ${at}, 'details', json(${threadDetailsSql}),
        'page', json(${threadEntriesSql(true, pairs)})) END AS value
    FROM acting_session s LEFT JOIN chat_scope t ON 1`);
}

// Cache only the scoped invalidation key and positions, never authored text.
export const chatThreadSyncProjection: SyncProjectionReader = {
  kind: chatThreadKind,
  schema: syncProjectionSchema.shape.value,
  snapshotIds: (now) => ({ sql: `WITH clock(at) AS (VALUES (?)),
    chat_targets AS MATERIALIZED (${chatTargets("t.id > (SELECT after_id FROM snapshot_scope)")})
    SELECT id AS resource_id FROM (${chatParticipants("c.id = (SELECT context_id FROM snapshot_scope)")})`, params: [now] }),
  project: (now) => ({ sql: `WITH clock(at) AS (VALUES (?)), chat_targets AS MATERIALIZED (${chatTargets(
    `t.id IN (SELECT resource_id FROM projection_keys WHERE kind = '${chatThreadKind}')`)})
    SELECT id AS resource_id, json_object('threadId', id, 'audience', audience, 'lastPosition', last_position,
      'readPosition', ${savedReadPosition("member")}) AS value
    FROM (${chatParticipants("c.id = (SELECT context_id FROM live_scope)")}) member`, params: [now] }),
};

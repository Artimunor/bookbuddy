import type { CrewMember, CrewRoster } from "@bookbuddy/api-contract";
import type { CommandStatement } from "../../db/commit";
import { accessClock, at, checkPriority, displayName, eligibilityCutoff, eligibilityStatus, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { availabilityWeekFilter, intervalsJson, weekBounds } from "../schedule/availability";
import { calendarDay, calendarWeek, dayBoundsByZone, intersect, mergeSpans } from "../schedule/calendar";
import type { Span } from "../schedule/calendar";
import { approvedVersion, foreman, jobOpen, noWithdrawal } from "../schedule/policy";

const pageSize = 50;
export const span = (row: string) => `json_object('startsAt', ${row}.starts_at, 'endsAt', ${row}.ends_at)`;
export const list = (rows: string) => `(SELECT json_group_array(json(value)) FROM (${rows}))`;
const bool = (sql: string) => `json(CASE WHEN ${sql} THEN 'true' ELSE 'false' END)`;
export const tags = (table: "member_skills" | "member_languages", member: string) => `(SELECT json_group_array(tag) FROM (
  SELECT tag FROM ${table} WHERE membership_id = ${member} ORDER BY tag))`;

export const approvedJob = (j: string) => `EXISTS (SELECT 1 FROM quote_versions q WHERE ${approvedVersion(j)} AND ${noWithdrawal()})`;
export const staffingForeman = (scope: string, j: string) => `(${currentMembership(scope, at)} IS NOT NULL AND ${foreman(scope, j)})`;

// No site access, private contact, or customer fields belong in this selection.
export function shiftTarget(where: string) {
  return `SELECT sh.id AS shift_id, sh.starts_at, sh.ends_at, sh.skill, sh.briefing_language, sh.state AS shift_state,
    v.id AS visit_id, v.state AS visit_state, v.cancelled_at, j.id, j.business_id, j.reference, j.state,
    j.accountable_foreman_membership_id, b.public_name AS business_name, b.state AS business_state, p.state AS place_state,
    coalesce(nullif(j.trade, ''), sh.skill) AS task, coalesce(p.site_zone, area.site_zone) AS site_zone, area.name AS town
    FROM shifts sh JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id JOIN businesses b ON b.id = j.business_id
    JOIN places p ON p.id = j.place_id JOIN operating_areas area ON area.id = coalesce(p.area_id, b.catchment_id)
    WHERE ${where}`;
}

export const shiftNeed = (g: string) => `json_object('shiftId', ${g}.shift_id, 'reference', ${g}.reference, 'window', ${span(g)},
  'siteZone', ${g}.site_zone, 'task', ${g}.task, 'skill', ${g}.skill, 'briefingLanguage', ${g}.briefing_language)`;
export const activeGap = (slot: string) => `(SELECT cg.id FROM cover_gaps cg WHERE cg.slot_id = ${slot}
  AND cg.state IN ('open', 'accepted_pending_confirmation'))`;
export const liveAssignment = (slot: string) => `EXISTS (SELECT 1 FROM assignments a WHERE a.slot_id = ${slot} AND a.state = 'confirmed')`;

function ownCrew(business: string, where = "1") {
  return `SELECT m.id, m.business_id, m.account_id, ${displayName("a")} AS name
    FROM memberships m JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    WHERE m.business_id = ${business} AND m.state = 'active' AND (${where}) AND EXISTS (SELECT 1 FROM membership_roles r
      WHERE r.membership_id = m.id AND r.role = 'worker' AND r.granted_at <= ${at} AND r.revoked_at IS NULL)`;
}

const overlaps = (row: string, start: string, end: string) => `${row}.starts_at < ${end} AND ${row}.ends_at > ${start}`;
const intervals = (member: string) => `h.membership_id = ${member} AND h.recorded_at <= ${at}`;
const unavailableAt = (member: string, start: string, end: string) => `EXISTS (SELECT 1 FROM availability_intervals h
  WHERE ${intervals(member)} AND h.kind = 'unavailable' AND ${overlaps("h", start, end)})`;
const openToCover = (member: string) => `(SELECT max(h.ends_at) FROM availability_intervals h WHERE ${intervals(member)}
  AND h.kind = 'available' AND h.open_to_cover = 1 AND h.starts_at <= ${at} AND h.ends_at > ${at}
  AND NOT ${unavailableAt(member, at, `${at} + 1`)})`;

function confirmedBusy(account: string, start: string, end: string) {
  return `SELECT a.starts_at, a.ends_at FROM memberships peer JOIN assignments a ON a.worker_membership_id = peer.id
    JOIN shift_slots slot ON slot.id = a.slot_id JOIN shifts sh ON sh.id = slot.shift_id
    JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id
    WHERE peer.account_id = ${account} AND a.state = 'confirmed' AND a.confirmed_at <= ${at}
      AND sh.state IN ('planned', 'active') AND v.state = 'booked' AND j.state = 'open' AND ${overlaps("a", start, end)}`;
}

function heldCoverBusy(account: string, start: string, end: string) {
  return `SELECT sh.starts_at, sh.ends_at FROM memberships peer JOIN cover_offers o ON o.recipient_id = peer.id
    JOIN cover_gaps g ON g.id = o.gap_id AND g.state = 'accepted_pending_confirmation'
    JOIN cover_rounds r ON r.gap_id = g.id AND r.round_no = g.current_round_no AND r.winner_offer_id = o.id
    JOIN shift_slots slot ON slot.id = g.slot_id JOIN shifts sh ON sh.id = slot.shift_id
    JOIN visits v ON v.id = sh.visit_id AND v.state = 'booked'
    WHERE peer.account_id = ${account} AND o.state = 'offered' AND r.state = 'accepted_pending_confirmation'
      AND r.accepted_at <= ${at} AND min(r.confirm_by, g.safe_cutoff, sh.starts_at) > ${at}
      AND sh.state = 'planned' AND ${overlaps("sh", start, end)}`;
}

function datedCoverage(member: string, g: string) {
  // Only dated coverage is a staffing commitment. Recorded unavailable/rest
  // intervals veto it; recurring hours and opt-in are only preferences.
  return `EXISTS (SELECT count(*) FROM (
    SELECT h.starts_at, h.ends_at, max(h.ends_at) OVER (ORDER BY h.starts_at, h.ends_at, h.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
    FROM availability_intervals h WHERE ${intervals(member)} AND h.kind IN ('available', 'duty')
      AND ${overlaps("h", `${g}.starts_at`, `${g}.ends_at`)}
  ) HAVING count(*) > 0 AND min(starts_at) <= ${g}.starts_at AND max(ends_at) >= ${g}.ends_at
    AND max(CASE WHEN starts_at > previous_end THEN 1 ELSE 0 END) = 0)`;
}

const effectiveState = `coalesce(${eligibilityStatus("e")}, 'pending')`;
const eligibilityJson = (status: string, cutoff: string) => `json_object('state', ${status}, 'validUntil', ${cutoff})`;
const workerEligibility = (member: string, business: string) => `e.membership_id = ${member} AND e.business_id = ${business}
  AND e.scope = 'internal' AND (e.checked_at IS NULL OR e.checked_at <= ${at})`;

export function ordinaryFitRows(g: string, selection = "1") {
  return `SELECT m.*, ${effectiveState} AS eligibility, ${eligibilityCutoff("e")} AS valid_until,
    EXISTS (SELECT 1 FROM member_skills sk WHERE sk.membership_id = m.id AND sk.tag = ${g}.skill) AS skilled,
    EXISTS (SELECT 1 FROM member_languages l WHERE l.membership_id = m.id AND l.tag = ${g}.briefing_language) AS briefable,
    ${unavailableAt("m.id", `${g}.starts_at`, `${g}.ends_at`)} AS unavailable, ${datedCoverage("m.id", g)} AS covered,
    (SELECT ${span("b")} FROM (${confirmedBusy("m.account_id", `${g}.starts_at`, `${g}.ends_at`)}
      UNION ALL ${heldCoverBusy("m.account_id", `${g}.starts_at`, `${g}.ends_at`)}) b ORDER BY starts_at, ends_at LIMIT 1) AS busy
    FROM (${ownCrew(`${g}.business_id`, selection)}) m LEFT JOIN eligibility_checks e ON e.id = (
      SELECT e.id FROM eligibility_checks e WHERE ${workerEligibility("m.id", "m.business_id")}
      AND e.trade = ${g}.skill AND e.work_language = ${g}.briefing_language
      ORDER BY coalesce(e.checked_at, -1) DESC, e.id DESC LIMIT 1)`;
}

const eligible = (f: string, g: string) => `(${f}.skilled AND ${f}.briefable AND ${f}.eligibility IN ('approved', 'expiring')
  AND ${f}.valid_until >= ${g}.ends_at)`;
const available = (f: string) => `(${f}.covered AND NOT ${f}.unavailable AND ${f}.busy IS NULL)`;
export const canStaff = (g: string, member: string) => `EXISTS (SELECT 1 FROM (${ordinaryFitRows(g, `m.id = ${member}`)}) f
  WHERE ${eligible("f", g)} AND ${available("f")})`;

export const fitAvailability = (f: string) => `CASE WHEN ${f}.busy IS NOT NULL THEN json_object('state', 'busy', 'window', json(${f}.busy))
  ELSE json_object('state', CASE WHEN ${f}.unavailable THEN 'unavailable' WHEN ${f}.covered THEN 'free' ELSE 'unknown' END) END`;
const fitJson = (f: string, g: string) => `json_object('result', CASE WHEN NOT coalesce(${eligible(f, g)}, 0) THEN 'not_eligible'
    WHEN ${f}.unavailable OR ${f}.busy IS NOT NULL THEN 'conflict' WHEN ${available(f)} THEN 'available' ELSE 'checking' END,
  'checkedAt', ${at}, 'skillMatches', ${bool(`${f}.skilled`)}, 'briefingLanguageMatches', ${bool(`${f}.briefable`)},
  'availability', json(${fitAvailability(f)}), 'eligibility', ${eligibilityJson(`${f}.eligibility`, `${f}.valid_until`)})`;

const profileFields = (m: string) => `'membershipId', ${m}.id, 'displayName', ${m}.name,
  'skills', json(${tags("member_skills", `${m}.id`)}), 'workingLanguages', json(${tags("member_languages", `${m}.id`)}),
  'openToCoverUntil', ${openToCover(`${m}.id`)}`;
const rosterEligibility = (m: string) => `coalesce((SELECT ${eligibilityJson("picked.status", "picked.cutoff")} FROM (
  SELECT ${effectiveState} AS status, ${eligibilityCutoff("e")} AS cutoff, e.id,
    row_number() OVER (PARTITION BY e.trade, e.work_language ORDER BY coalesce(e.checked_at, -1) DESC, e.id DESC) AS position
  FROM eligibility_checks e WHERE ${workerEligibility(`${m}.id`, `${m}.business_id`)}
  ) picked WHERE picked.position = 1 ORDER BY ${checkPriority("picked.status")}, picked.cutoff ASC NULLS LAST, picked.id LIMIT 1),
  ${eligibilityJson("'pending'", "NULL")})`;

export function namedOfferJson(o: string, extra = "") {
  return `json_object('offerId', ${o}.id, 'slotId', ${o}.slot_id, 'sentAt', ${o}.issued_at, 'replyBy', ${o}.expires_at,
    'recipient', (SELECT json_object('membershipId', m.id, 'displayName', ${displayName("a")}) FROM memberships m
      JOIN accounts a ON a.id = m.account_id WHERE m.id = ${o}.recipient_id)${extra})`;
}

export function readShiftCandidates(session: SessionAccess, now: number, shiftId: string): CommandStatement {
  const slotRows = list(`SELECT json_object('slotId', slot.id, 'number', slot.number, 'isLead', ${bool("slot.is_lead = 1")},
    'availability', CASE WHEN assigned THEN 'assigned' WHEN gap IS NOT NULL THEN 'cover_gap'
      WHEN pending IS NOT NULL THEN 'offered' ELSE 'vacant' END,
    'pendingOffer', json(CASE WHEN NOT assigned AND gap IS NULL THEN pending END),
    'coverGapId', CASE WHEN NOT assigned THEN gap END) AS value
    FROM (SELECT slot.*, ${liveAssignment("slot.id")} AS assigned, (SELECT cg.id FROM cover_gaps cg
      JOIN assignments prior ON prior.id = cg.prior_assignment_id WHERE cg.slot_id = slot.id
      ORDER BY cg.state IN ('open', 'accepted_pending_confirmation') DESC, prior.dropped_at DESC, cg.id DESC LIMIT 1) AS gap,
    (SELECT ${namedOfferJson("o", ", 'state', 'offered'")}
      FROM assignment_offers o JOIN memberships m ON m.id = o.recipient_id AND m.business_id = g.business_id
      WHERE o.slot_id = slot.id AND o.state = 'offered' AND o.issued_at <= ${at} AND o.expires_at > ${at}
        AND g.shift_state = 'planned' AND g.visit_state = 'booked' AND g.starts_at > ${at}) AS pending
      FROM shift_slots slot WHERE slot.shift_id = g.shift_id) slot ORDER BY slot.number`);
  const candidates = `(WITH fit AS MATERIALIZED (${ordinaryFitRows("g")})
    SELECT json_group_array(json(value)) FROM (
      SELECT json_object(${profileFields("f")}, 'fit', ${fitJson("f", "g")}) AS value FROM fit f ORDER BY f.name COLLATE NOCASE, f.id))`;
  return scopedStatement(accessClock(session, now), `SELECT (SELECT json_object('shift', ${shiftNeed("g")}, 'businessName', g.business_name,
    'slots', json(${slotRows}), 'candidates', json(${candidates}))
    FROM live_scope scope CROSS JOIN (${shiftTarget("sh.id = ?")}) g
    WHERE ${staffingForeman("scope", "g")} AND ${jobOpen("g")} AND ${approvedJob("g")}) AS value FROM acting_session`, shiftId);
}

function crewScope() {
  return `crew_scope AS MATERIALIZED (SELECT s.*, b.public_name, area.site_zone FROM live_scope s
    JOIN businesses b ON b.id = s.business_id AND b.state = 'approved' JOIN operating_areas area ON area.id = b.catchment_id
    WHERE ${currentMembership("s", at)} IS NOT NULL AND (s.role = 'provider_admin' OR (s.role = 'foreman' AND EXISTS (
      SELECT 1 FROM jobs j JOIN places p ON p.id = j.place_id AND p.state = 'in_area'
      WHERE j.business_id = s.business_id AND j.state = 'open' AND ${foreman("s", "j")} AND ${approvedJob("j")}))))`;
}

interface CrewQuery { search?: string | undefined; filter?: string | undefined; cursor?: string | undefined }
export function readCrew(session: SessionAccess, now: number, query: CrewQuery): CommandStatement | null {
  const cursor = query.cursor ? /^([0-3])~([A-Za-z0-9_-]{1,256})$/.exec(query.cursor) : null;
  if (query.cursor && !cursor) return null;
  const attendance = (kind: "arrival" | "departure") => `(SELECT e.actual_at FROM attendance_events e WHERE e.assignment_id = a.id
    AND e.kind = '${kind}' AND e.review_state = 'accepted' AND e.received_at <= ${at} AND NOT EXISTS (
      SELECT 1 FROM attendance_events c WHERE c.corrects_id = e.id AND c.review_state = 'accepted' AND c.received_at <= ${at})
    ORDER BY e.received_at DESC, e.id DESC LIMIT 1)`;
  const working = `(day.shift_state = 'active' AND work_started IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM safety_holds h WHERE h.assignment_id = day.id AND h.state = 'active'))`;
  // Other jobs influence anonymous availability, not the person's live phase
  // or briefing. A provider-admin roster also carries only that summary.
  const dayAssignment = `(SELECT json_object('state', 'assigned', 'reference', day.reference,
    'phase', CASE WHEN departure IS NOT NULL THEN 'departed' WHEN arrival IS NOT NULL
      THEN CASE WHEN ${working} THEN 'working' ELSE 'on_site' END
      WHEN setting_off IS NOT NULL THEN 'on_the_way' ELSE 'confirmed' END,
    'at', coalesce(departure, CASE WHEN arrival IS NOT NULL AND ${working} THEN max(arrival, work_started) END,
      arrival, setting_off, day.confirmed_at),
    'briefing', CASE
      WHEN EXISTS (SELECT 1 FROM safety_holds h WHERE h.assignment_id = day.id AND h.state = 'active' AND h.version_id IS NOT NULL) THEN 'hold'
      WHEN EXISTS (SELECT 1 FROM safety_holds h WHERE h.assignment_id = day.id AND h.kind = 'briefing' AND h.state = 'cleared')
        AND NOT EXISTS (SELECT 1 FROM safety_holds h WHERE h.assignment_id = day.id AND h.state = 'active') THEN 'acknowledged' ELSE 'due' END)
    FROM (SELECT a.id, a.confirmed_at, j.reference, sh.state AS shift_state, ${attendance("arrival")} AS arrival, ${attendance("departure")} AS departure,
      (SELECT max(e.at) FROM visit_activity_events e WHERE e.assignment_id = a.id AND e.kind = 'setting_off' AND e.at <= ${at}) AS setting_off,
      (SELECT max(e.at) FROM visit_activity_events e WHERE e.visit_id = v.id AND e.kind = 'work_started' AND e.at <= ${at}) AS work_started
    FROM assignments a JOIN shift_slots slot ON slot.id = a.slot_id JOIN shifts sh ON sh.id = slot.shift_id
    JOIN visits v ON v.id = sh.visit_id JOIN jobs j ON j.id = v.job_id
    WHERE a.worker_membership_id = m.id AND j.business_id = m.business_id AND a.state IN ('confirmed', 'completed')
      AND a.confirmed_at <= ${at} AND j.state = 'open' AND v.state IN ('booked', 'finished') AND sh.state <> 'cancelled'
      AND ${foreman("s", "j")} AND ${overlaps("a", "s.day_start", "s.day_end")}
    ORDER BY a.ends_at <= ${at}, a.starts_at, a.id LIMIT 1) day)`;
  const roster = list(`SELECT json_object('rank', m.rank, 'member', json_object(${profileFields("m")},
    'eligibility', json(m.eligibility), 'status', json(CASE m.rank WHEN 0 THEN m.assigned
      WHEN 1 THEN json_object('state', 'free', 'until', min(m.available_until, coalesce(m.next_busy, m.available_until)))
      WHEN 2 THEN json_object('state', 'unavailable', 'since', m.off_since)
      ELSE json_object('state', 'not_assignable', 'eligibility', json(m.eligibility)) END))) AS value
    FROM roster m CROSS JOIN crew_input x WHERE (m.rank, m.id) > (x.rank, x.after_id)
    ORDER BY m.rank, m.id LIMIT ${pageSize + 1}`);
  const bounds = [now - calendarDay, now, now + calendarDay].map((instant) => {
    const date = new Date(instant).toISOString().slice(0, 10);
    return [date, dayBoundsByZone(date)] as const;
  });
  return scopedStatement(accessClock(session, now), `, ${crewScope()},
    crew_input(search, filter, rank, after_id) AS (VALUES (?, ?, ?, ?)), days(date, zones) AS (VALUES (?, ?), (?, ?), (?, ?)),
    business_day AS MATERIALIZED (SELECT s.*, d.date, (d.zones -> s.site_zone) ->> 0 AS day_start, (d.zones -> s.site_zone) ->> 1 AS day_end
      FROM crew_scope s CROSS JOIN days d WHERE ${at} >= (d.zones -> s.site_zone) ->> 0 AND ${at} < (d.zones -> s.site_zone) ->> 1),
    facts AS MATERIALIZED (SELECT m.*, ${rosterEligibility("m")} AS eligibility, ${dayAssignment} AS assigned,
      (SELECT max(h.ends_at) FROM availability_intervals h WHERE ${intervals("m.id")} AND h.kind IN ('available', 'duty')
        AND h.starts_at <= ${at} AND h.ends_at > ${at}) AS available_until,
      (SELECT min(h.starts_at) FROM availability_intervals h WHERE ${intervals("m.id")} AND h.kind = 'unavailable'
        AND h.starts_at <= ${at} AND h.ends_at > ${at}) AS off_since,
      (SELECT min(starts_at) FROM (${confirmedBusy("m.account_id", at, "s.day_end")}
        UNION ALL SELECT h.starts_at, h.ends_at FROM availability_intervals h WHERE ${intervals("m.id")} AND h.kind = 'unavailable'
          AND h.starts_at > ${at} AND h.starts_at < s.day_end)) AS next_busy
      FROM business_day s CROSS JOIN crew_input x CROSS JOIN (${ownCrew("(SELECT business_id FROM business_day)")}) m WHERE x.search IS NULL
        OR instr(lower(m.name), lower(x.search)) > 0 OR EXISTS (SELECT 1 FROM member_skills k WHERE k.membership_id = m.id AND instr(lower(k.tag), lower(x.search)) > 0)
        OR EXISTS (SELECT 1 FROM member_languages k WHERE k.membership_id = m.id AND instr(lower(k.tag), lower(x.search)) > 0)),
    ranked AS (SELECT m.*, CASE WHEN m.assigned IS NOT NULL THEN 0 WHEN m.eligibility ->> 'state' NOT IN ('approved', 'expiring') THEN 3
      WHEN m.can_work_now THEN 1 ELSE 2 END AS rank FROM (
        SELECT facts.*, (available_until IS NOT NULL AND off_since IS NULL AND (next_busy IS NULL OR next_busy > ${at})
          AND eligibility ->> 'state' IN ('approved', 'expiring')) AS can_work_now FROM facts) m),
    roster AS MATERIALIZED (SELECT m.* FROM ranked m CROSS JOIN crew_input x
      WHERE x.filter IS NULL OR x.filter = 'all' OR (x.filter = 'free_now' AND m.can_work_now)
        OR (x.filter = 'open_to_cover' AND ${openToCover("m.id")} IS NOT NULL))
    SELECT (SELECT json_object('businessId', s.business_id, 'businessName', s.public_name, 'siteZone', s.site_zone,
      'date', s.date, 'total', (SELECT count(*) FROM roster), 'rows', json(${roster}))
      FROM business_day s) AS value FROM acting_session`,
  query.search ?? null, query.filter ?? null, cursor ? Number(cursor[1]) : -1, cursor?.[2] ?? "", ...bounds.flat());
}

export function projectCrew(value: unknown): CrewRoster {
  const { rows, ...scope } = value as Omit<CrewRoster, "members" | "page"> & { rows: { rank: number; member: CrewRoster["members"][number] }[] };
  const hasMore = rows.length > pageSize;
  if (hasMore) rows.pop();
  const last = rows.at(-1);
  return { ...scope, members: rows.map(({ member }) => member), page: { hasMore,
    cursor: hasMore && last ? `${last.rank}~${last.member.membershipId}` : null } };
}

export function readCrewMember(session: SessionAccess, now: number, memberId: string, shiftId: string | null, weekOf: string | null): CommandStatement {
  const day = "input.week_of";
  const { start, end } = weekBounds(at, day);
  const shiftFit = `(SELECT (SELECT json_object('shift', ${shiftNeed("g")}, 'fit', ${fitJson("f", "g")}, 'crewThreadId', NULL)
      FROM (${ordinaryFitRows("g", "m.id = crew.id")}) f)
    FROM (${shiftTarget("sh.id = input.shift_id")}) g
    WHERE ${staffingForeman("s", "g")} AND ${jobOpen("g")} AND ${approvedJob("g")})`;
  return scopedStatement(accessClock(session, now), `, ${crewScope()}, crew_input(member_id, shift_id, week_of) AS (VALUES (?, ?, ?)),
    detail AS MATERIALIZED (SELECT s.business_id, s.public_name AS business_name, s.site_zone,
      json_object(${profileFields("crew")}) AS member, ${rosterEligibility("crew")} AS eligibility,
      ${intervalsJson("crew.id", `a.recorded_at <= ${at} AND ${availabilityWeekFilter(at, day)}`)} AS intervals,
      ${list(`SELECT ${span("b")} AS value FROM (${confirmedBusy("crew.account_id", start, end)}) b`)} AS busy,
      input.shift_id, CASE WHEN input.shift_id IS NOT NULL THEN ${shiftFit} END AS fit
      FROM crew_scope s CROSS JOIN crew_input input
      CROSS JOIN (${ownCrew("(SELECT business_id FROM crew_scope)", "m.id = (SELECT member_id FROM crew_input)")}) crew)
    SELECT (SELECT json_object('businessId', d.business_id, 'businessName', d.business_name, 'siteZone', d.site_zone,
      'member', json(d.member), 'eligibility', json(d.eligibility), 'intervals', json(d.intervals), 'busy', json(d.busy), 'shiftFit', json(d.fit))
      FROM detail d WHERE d.shift_id IS NULL OR d.fit IS NOT NULL) AS value FROM acting_session`, memberId, shiftId, weekOf);
}

interface Hours {
  day: string;
  kind: "available" | "unavailable" | "duty";
  startsAt: number | null;
  endsAt: number | null;
  startOffset: number | null;
  endOffset: number | null;
}

function subtractHours(available: Span[], blocked: Span[]): Span[] {
  let free = available;
  for (const off of blocked) free = free.flatMap((range) => {
    if (!intersect(range, off)) return [range];
    return [...range.startsAt < off.startsAt ? [{ startsAt: range.startsAt, endsAt: off.startsAt }] : [],
      ...off.endsAt < range.endsAt ? [{ startsAt: off.endsAt, endsAt: range.endsAt }] : []];
  });
  return free;
}

export function projectCrewMember(value: unknown, now: number, weekOf: string | null): CrewMember {
  const { intervals, busy, ...profile } = value as Omit<CrewMember, "availability"> & { intervals: Hours[]; busy: Span[] };
  const availability = calendarWeek(profile.siteZone, now, weekOf).map(({ date, weekday, toUtc }) => {
    const day = toUtc(0, calendarDay);
    const dated = intervals.filter((row) => row.day === date);
    const rows = dated.length ? dated : intervals.filter((row) => row.day === weekday);
    const cap = (range: Span) => day.flatMap((bounds) => intersect(range, bounds) ?? []);
    const hours = (row: Hours) => row.startsAt === null || row.endsAt === null
      ? toUtc(row.startOffset!, row.endOffset!) : cap({ startsAt: row.startsAt, endsAt: row.endsAt });
    return { date, available: subtractHours(mergeSpans(rows.filter((row) => row.kind !== "unavailable").flatMap(hours)),
      mergeSpans(rows.filter((row) => row.kind === "unavailable").flatMap(hours))), busy: mergeSpans(busy.flatMap(cap)) };
  });
  return { ...profile, availability };
}

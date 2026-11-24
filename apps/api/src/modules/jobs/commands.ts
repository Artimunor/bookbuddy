import type { ErrorBody, HandoffReceipt, OperationId, RouteResponse, SubmitRequest, offerJobHandoffRoute, declineJobHandoffRoute, submitSupportRoute } from "@bookbuddy/api-contract";
import { projectJourney } from "@bookbuddy/domain";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { bumpVisibilityEpoch, planOperation, recordEffectIntents } from "../../db/operations";
import type { OperationResult, OperationSpec } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { at, liveTerm, scopedStatement } from "../access/policy";
import { loadDeliveryKey, mac, sealDelivery } from "../auth/crypto";
import type { SessionAccess } from "../auth/session";
import { createLinkedNotifications } from "../links/notifications";

export interface JobCommandResult {
  operation: OperationResult;
  value: string | null;
  error?: ErrorBody;
}

type Projection = { value: string | null; revision: number | null };

async function planReceipt(ctx: RequestScope, access: SessionAccess, spec: Omit<OperationSpec, "access">,
  projection: CommandStatement, revision?: { sql: string; expected: number },
): Promise<CommandInput<JobCommandResult>> {
  const plan = await planOperation(ctx, { ...spec, access });
  const authorize = spec.authorize ?? { sql: "1" };
  const result = scopedStatement(access, `SELECT (${projection.sql}) AS value, (${revision?.sql ?? "NULL"}) AS revision
    FROM live_scope scope LEFT JOIN operation_receipts r ON r.account_id = scope.account_id AND r.context_id = scope.context_id
      AND r.operation_id = ? AND r.command = ? WHERE (${authorize.sql})`,
  ...projection.params ?? [], spec.operationId, spec.command, ...authorize.params ?? []);
  const index = plan.statements.length;
  return { statements: [...plan.statements, result], decode(results) {
    const operation = plan.decode(results);
    const row = results[index]?.results[0] as Projection | undefined;
    if (operation.outcome.status === "rejected") {
      const error: ErrorBody = operation.outcome.error.code === "CONFLICT" && revision && row?.revision != null && row.revision !== revision.expected
        ? { code: "STALE_REVISION", current: { kind: "revision", revision: row.revision } }
        : operation.outcome.error;
      return { operation, value: null, error };
    }
    return { operation, value: row?.value ?? null };
  } };
}

const minute = 60_000, day = 24 * 60 * minute, week = 7 * day;
const offerMinutes = { standard: 120, urgent: 30 } as const;
const clockWeeks = 6;
let cachedClock: { from: number; until: number; offsets: string } | undefined;

function offsetAt(formatter: Intl.DateTimeFormat, ms: number): number {
  const zone = formatter.formatToParts(ms).find(({ type }) => type === "timeZoneName")?.value;
  if (zone === "GMT") return 0;
  const match = /^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/.exec(zone ?? "");
  if (!match) throw new RangeError("Staffed calendar could not resolve the site offset");
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 * minute + Number(match[3]) * minute + Number(match[4] ?? 0) * 1_000);
}

// D1 has no IANA conversion function. Supply immutable UTC offset segments for
// the next five full weeks, but pick the authoritative site zone and calendar in
// SQL. Neither the client nor the Worker host's local zone chooses a deadline.
function staffedOffsets(now: number): string {
  if (cachedClock && now >= cachedClock.from && now < cachedClock.until) return cachedClock.offsets;
  const from = Math.floor(now / week) * week;
  const end = from + clockWeeks * week;
  const zones: Record<string, [number, number, number][]> = {
    UTC: [[from, end, 0]], "Etc/UTC": [[from, end, 0]], "Etc/GMT": [[from, end, 0]], GMT: [[from, end, 0]],
  };
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    let offset = offsetAt(formatter, from), start = from;
    const intervals: [number, number, number][] = [];
    for (let sample = from + week; sample <= end; sample += week) {
      const next = offsetAt(formatter, sample);
      if (next === offset) continue;
      let lo = (sample - week) / 1_000, hi = sample / 1_000;
      while (hi - lo > 1) {
        const mid = Math.floor((hi + lo) / 2);
        if (offsetAt(formatter, mid * 1_000) === offset) lo = mid;
        else hi = mid;
      }
      const transition = hi * 1_000;
      intervals.push([start, transition, offset]);
      start = transition;
      offset = next;
    }
    intervals.push([start, end, offset]);
    zones[zone] = intervals;
  }
  const offsets = JSON.stringify(zones);
  cachedClock = { from, until: from + week, offsets };
  return offsets;
}

function withDeadline(access: SessionAccess, now: number, minutes: number): SessionAccess {
  const duration = minutes * minute;
  return { sql: `${access.sql},
    staffed_days(wall_ms) AS (
      SELECT (? / ${day} - 1) * ${day}
      UNION ALL SELECT wall_ms + ${day} FROM staffed_days WHERE wall_ms < (? / ${day} + ${clockWeeks * 7 + 1}) * ${day}
    ), staffed_windows AS (
      SELECT max(${at}, zone.value ->> '$[0]', d.wall_ms + ${minute} *
          CASE WHEN holiday.id IS NULL THEN weekday.opens_minute ELSE holiday.opens_minute END - (zone.value ->> '$[2]')) AS starts,
        min(zone.value ->> '$[1]', d.wall_ms + ${minute} *
          CASE WHEN holiday.id IS NULL THEN weekday.closes_minute ELSE holiday.closes_minute END - (zone.value ->> '$[2]')) AS ends
      FROM calendar_area area CROSS JOIN json_each(? -> ('$.' || json_quote(area.site_zone))) zone CROSS JOIN staffed_days d
      LEFT JOIN staffed_calendar holiday ON holiday.area_id = area.id AND holiday.local_date = date(d.wall_ms / 1000, 'unixepoch')
      LEFT JOIN staffed_calendar weekday ON weekday.area_id = area.id AND weekday.weekday =
        (CAST(strftime('%w', d.wall_ms / 1000, 'unixepoch') AS INTEGER) + 6) % 7 + 1
    ), staffed_elapsed AS (
      SELECT starts, ends, sum(ends - starts) OVER (ORDER BY starts ROWS UNBOUNDED PRECEDING) AS elapsed
      FROM staffed_windows WHERE starts < ends
    ), deadline AS MATERIALIZED (
      SELECT ends - (elapsed - ?) AS expires_at FROM staffed_elapsed WHERE elapsed >= ? ORDER BY starts LIMIT 1
    )`, params: [...access.params, now, now, staffedOffsets(now), duration, duration] };
}

function foremanScope(condition: string): string {
  return `SELECT c.id AS context_id, m.id AS membership_id, m.business_id, m.account_id FROM account_contexts c
    JOIN membership_roles r ON r.id = c.role_grant_id AND r.role = 'foreman' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    JOIN memberships m ON m.id = r.membership_id AND m.state = 'active'
    JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    WHERE c.role = 'foreman' AND (${condition})`;
}

function adminScope(condition: string): string {
  return `SELECT c.id AS context_id, m.id AS membership_id, m.business_id, m.account_id FROM account_contexts c
    JOIN membership_roles r ON r.id = c.role_grant_id AND r.role = 'provider_admin' AND r.revoked_at IS NULL AND r.granted_at <= ${at}
    JOIN memberships m ON m.id = r.membership_id AND m.state = 'active'
    JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
    JOIN businesses b ON b.id = m.business_id AND b.state = 'approved'
    WHERE c.role = 'provider_admin' AND (${condition})`;
}

function liveProviderHandoff(business: string): string {
  return `scope.role = 'provider_admin' AND scope.business_id = ${business} AND EXISTS (
    SELECT 1 FROM account_contexts c JOIN membership_roles r ON r.id = c.role_grant_id AND r.granted_at <= ${at}
    JOIN business_grants g ON g.membership_id = r.membership_id AND g.business_id = ${business} AND g.capability = 'handoff'
    WHERE c.id = scope.context_id AND ${liveTerm("g")})`;
}

const liveIntake = (grant: string) => `${grant}.capability = 'intake' AND ${liveTerm(grant)}`;

function notification(access: SessionAccess, guard: CommandStatement, ref: string, kind: string, audience: CommandStatement,
  now: number, expiresAt: CommandStatement, jobId?: string,
) {
  const event = `${kind}:${ref}`;
  const matching = scopedStatement(access, `SELECT n.id, n.context_id FROM notifications n
    WHERE n.context_id IN (${audience.sql}) AND n.event_key = ?`, ...audience.params ?? [], event);
  const targets = scopedStatement(access, `SELECT ? AS kind, ? AS resource_id, a.context_id AS required_scope,
    (${expiresAt.sql}) AS expires_at, ${at} AS created_at FROM (${audience.sql}) a`,
  jobId === undefined ? "job_handoff" : "job_update", jobId ?? ref, ...expiresAt.params ?? [], ...audience.params ?? []);
  return {
    writes: createLinkedNotifications(targets, guard, event, kind),
    changes: `SELECT 'notification', n.id, n.context_id, 'upsert', ${at} FROM (${matching.sql}) n`,
    params: matching.params ?? [],
    effects: { sql: `SELECT lower(hex(randomblob(16))) AS id, 'notification_push' AS kind, 'notification_push:' || n.id AS dedupe_key,
      n.id AS resource_ref, ? AS due_at, (${expiresAt.sql}) AS expires_at FROM (${matching.sql}) n`,
    params: [now, ...expiresAt.params ?? [], ...matching.params ?? []] },
  };
}

function syncJob(includeCustomers: boolean): string {
  return `SELECT 'job' AS kind, j.id AS resource_id, a.context_id AS partition_key, 'upsert' AS op, ${at} AS at FROM job_record j JOIN (
    ${adminScope("m.business_id = (SELECT business_id FROM job_record)")}
    UNION ALL
    ${foremanScope(`m.business_id = (SELECT business_id FROM job_record) AND (m.id = (SELECT accountable_foreman_membership_id FROM job_record)
      OR EXISTS (SELECT 1 FROM job_grants g JOIN business_grants bg ON bg.membership_id = m.id AND bg.capability = 'backup_foreman'
        WHERE g.job_id = (SELECT id FROM job_record) AND g.context_id = c.id AND g.capability = 'backup'
          AND ${liveTerm("g")} AND ${liveTerm("bg")}))`)}
  ) a ON 1${includeCustomers ? ` UNION ALL
    SELECT 'job', j.id, c.id, 'upsert', ${at} FROM job_record j
    JOIN requests r ON r.job_id = j.id JOIN places p ON p.id = j.place_id AND p.state <> 'restricted'
    JOIN place_people pp ON pp.place_id = p.id AND pp.ends_at IS NULL AND pp.verified_from <= ${at}
    JOIN accounts ca ON ca.id = pp.account_id AND ca.state = 'active'
    JOIN account_contexts c ON c.account_id = pp.account_id AND c.role = 'customer'
    WHERE (pp.account_id = j.requester_id OR r.submitted_at >= pp.history_from)
      AND (p.owner_id = pp.account_id OR EXISTS (SELECT 1 FROM place_grants g WHERE g.place_id = p.id AND g.account_id = pp.account_id
        AND g.capability = 'view' AND ${liveTerm("g")}))` : ""}`;
}

function changesFor(now: number, job: string, sql: string, ...params: unknown[]): CommandStatement {
  return { sql: `WITH clock AS (SELECT ? AS at), job_record AS MATERIALIZED (SELECT * FROM jobs WHERE id = ?) ${sql}`, params: [now, job, ...params] };
}

function addIntakeGrant(access: SessionAccess, guard: CommandStatement, handoff: string): CommandStatement {
  return scopedStatement(access, `INSERT INTO job_grants (job_id, context_id, capability, valid_from, valid_until)
    SELECT h.job_id, recipient.context_id, 'intake', h.offered_at, h.expires_at
    FROM job_handoffs h JOIN recipient ON h.recipient_id = recipient.membership_id WHERE h.id = ? AND ${guard.sql}`,
  handoff, ...guard.params ?? []);
}

function revokeIntake(guard: CommandStatement, handoff: string, now: number): CommandStatement {
  return { sql: `UPDATE job_grants SET revoked_at = ? WHERE capability = 'intake' AND revoked_at IS NULL AND ${guard.sql}
    AND (job_id, context_id, valid_from, valid_until) IN (
      SELECT h.job_id, c.id, h.offered_at, h.expires_at FROM job_handoffs h
      JOIN memberships m ON m.id = h.recipient_id JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id
        AND c.role = 'foreman' WHERE h.id = ?)`, params: [now, ...guard.params ?? [], handoff] };
}

const offerRecipient = `SELECT c.id AS context_id FROM job_handoffs h JOIN memberships m ON m.id = h.recipient_id
  JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id AND c.role = 'foreman' WHERE h.id = ?`;
const incumbentContext = `SELECT c.id AS context_id FROM job_handoffs h JOIN memberships m ON m.id = h.incumbent_id
  JOIN account_contexts c ON c.business_id = m.business_id AND c.account_id = m.account_id AND c.role = 'foreman' WHERE h.id = ?`;

function handoffChanges(row: string, action: "upsert" | "remove"): string {
  return `SELECT 'job_handoff', ?, context_id, '${action}', ${at} FROM (${row})`;
}

const sentJourney = JSON.stringify(projectJourney({
  jobState: "open", quoteIssued: false, windowConfirmed: false, visitReached: false, signedOff: false, paymentMatched: false,
}));

export function planRequest(ctx: RequestScope, access: SessionAccess, input: SubmitRequest) {
  const { payload, expectedRevision, operationId } = input;
  const job = crypto.randomUUID(), handoff = crypto.randomUUID();
  const audience = { sql: offerRecipient, params: [handoff] };
  const requestAccess: SessionAccess = { sql: `${access.sql}, target_place AS MATERIALIZED (
      SELECT p.id, p.area_id, p.revision, s.account_id FROM live_scope s JOIN places p ON p.id = ? AND p.state = 'in_area'
      JOIN place_people pp ON pp.place_id = p.id AND pp.account_id = s.account_id AND pp.ends_at IS NULL AND pp.verified_from <= ${at}
      JOIN place_grants g ON g.place_id = p.id AND g.account_id = s.account_id AND g.capability = 'request' AND ${liveTerm("g")}
      WHERE s.role = 'customer'
    ), business_choice AS MATERIALIZED (
      SELECT min(b.id) AS id FROM target_place p JOIN businesses b ON b.catchment_id = p.area_id AND b.state = 'approved' HAVING count(*) = 1
    ), target_business AS MATERIALIZED (SELECT b.* FROM business_choice choice JOIN businesses b ON b.id = choice.id),
    calendar_area AS (SELECT a.* FROM operating_areas a JOIN target_business b ON b.catchment_id = a.id),
    recipient AS MATERIALIZED (${foremanScope("m.id = (SELECT default_foreman_id FROM target_business)")})`, params: [...access.params, payload.placeId] };
  const offerAccess = withDeadline(requestAccess, ctx.now, offerMinutes.standard);
  return planReceipt(ctx, offerAccess, {
    command: "jobs.submit_request", operationId, input, resultRef: job,
    authorize: { sql: "EXISTS (SELECT 1 FROM target_place)" },
    eligible: { sql: `EXISTS (SELECT 1 FROM target_place WHERE revision = ?) AND EXISTS (SELECT 1 FROM target_business)
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE requester_id = scope.account_id AND request_operation_id = ?)
      AND (NOT EXISTS (SELECT 1 FROM recipient) OR EXISTS (SELECT 1 FROM deadline))`, params: [expectedRevision, operationId] },
    writes: (guard) => {
      const notice = notification(requestAccess, guard, handoff, "job_handoff_offered", audience, ctx.now,
        { sql: "SELECT expires_at FROM job_handoffs WHERE id = ?", params: [handoff] });
      return {
      statements: [
        scopedStatement(requestAccess, `INSERT INTO jobs (id, reference, business_id, place_id, requester_id, trade, origin, state, request_operation_id)
          SELECT ?, ?, b.id, p.id, p.account_id, ?, 'bookbuddy', 'open', ? FROM target_place p CROSS JOIN target_business b WHERE ${guard.sql}`,
        job, `BB-${job.replaceAll("-", "").toUpperCase()}`, payload.trade ?? null, operationId, ...guard.params ?? []),
        { sql: `INSERT INTO requests (job_id, original_text, original_language, arrival_arrangement, arrival_contact_name, safe_note, submitted_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`, params: [job, payload.originalText!, payload.originalLanguage ?? null,
          payload.arrivalArrangement, payload.arrivalContactName ?? null, payload.safeNote ?? null, ctx.now, ...guard.params ?? []] },
        scopedStatement(offerAccess, `INSERT INTO job_handoffs (id, job_id, business_id, recipient_id, policy, offered_at, expires_at, state)
          SELECT ?, ?, business_id, membership_id, 'standard', ${at}, expires_at, 'offered' FROM recipient CROSS JOIN deadline WHERE ${guard.sql}`,
        handoff, job, ...guard.params ?? []),
        addIntakeGrant(requestAccess, guard, handoff),
        ...notice.writes,
      ],
      changes: changesFor(ctx.now, job, `${syncJob(true)} UNION ALL ${handoffChanges(offerRecipient, "upsert")} UNION ALL ${notice.changes}`,
        handoff, handoff, ...notice.params),
      effects: notice.effects,
    }; },
  }, { sql: `SELECT json_object('jobId', j.id, 'reference', j.reference, 'siteZone', p.site_zone, 'submittedAt', request.submitted_at, 'journey', json(?))
    FROM jobs j JOIN requests request ON request.job_id = j.id JOIN places p ON p.id = j.place_id
    WHERE j.id = r.result_ref AND j.requester_id = scope.account_id AND j.place_id = (SELECT id FROM target_place)`, params: [sentJourney] },
  { sql: "SELECT revision FROM target_place", expected: expectedRevision });
}

type Offer = RouteResponse<(typeof offerJobHandoffRoute)["input"]>["body"];
type Decision = RouteResponse<(typeof declineJobHandoffRoute)["input"]>["body"];

const handoffReceipt = (state: HandoffReceipt["state"], revision: number): CommandStatement => ({
  sql: `SELECT json_object('jobId', h.job_id, 'handoffId', h.id, 'revision', ?, 'state', '${state}', 'expiresAt', h.expires_at,
    'endedAt', ${state === "offered" ? "NULL" : "h.ended_at"}) FROM job_handoffs h
    WHERE h.id = r.result_ref AND h.job_id = (SELECT id FROM target_job)${state === "offered" ? "" : ` AND h.state = '${state}'`}`,
  params: [revision],
});

export function planHandoffOffer(ctx: RequestScope, access: SessionAccess, job: string, input: Offer) {
  const { expectedRevision, operationId, payload: { recipientMembershipId: member, reofferOfId, urgentCallConfirmed } } = input;
  const policy = urgentCallConfirmed ? "urgent" : "standard";
  const handoff = crypto.randomUUID();
  const target: SessionAccess = { sql: `${access.sql}, target_job AS MATERIALIZED (SELECT * FROM jobs WHERE id = ?),
    calendar_area AS (SELECT a.* FROM target_job j JOIN businesses b ON b.id = j.business_id JOIN operating_areas a ON a.id = b.catchment_id),
    recipient AS MATERIALIZED (${foremanScope("m.id = ? AND m.business_id = (SELECT business_id FROM target_job)")}),
    latest AS MATERIALIZED (SELECT h.* FROM job_handoffs h WHERE h.job_id = (SELECT id FROM target_job)
      ORDER BY h.offered_at DESC, h.rowid DESC LIMIT 1)`, params: [...access.params, job, member] };
  const offerAccess = withDeadline(target, ctx.now, offerMinutes[policy]);
  const nextOffer = reofferOfId === undefined
    ? "NOT EXISTS (SELECT 1 FROM latest WHERE NOT (state = 'accepted' OR (state = 'withdrawn' AND reoffer_of_id IS NULL)))"
    : `EXISTS (SELECT 1 FROM latest h WHERE h.id = ? AND h.reoffer_of_id IS NULL AND h.incumbent_id IS j.accountable_foreman_membership_id
        AND h.recipient_id <> target.membership_id
        AND (h.state IN ('declined', 'expired') OR (h.state = 'offered' AND h.expires_at <= ${at})))`;
  return planReceipt(ctx, offerAccess, {
    command: "jobs.offer_handoff", operationId, input: [job, input], resultRef: handoff,
    authorize: { sql: `EXISTS (SELECT 1 FROM target_job j WHERE ${liveProviderHandoff("j.business_id")})` },
    eligible: { sql: `EXISTS (SELECT 1 FROM target_job j CROSS JOIN recipient target CROSS JOIN deadline
      WHERE j.state = 'open' AND j.revision = ? AND j.accountable_foreman_membership_id IS NOT target.membership_id
        AND ${nextOffer} AND NOT EXISTS (SELECT 1 FROM job_grants g WHERE g.job_id = j.id AND g.context_id = target.context_id
          AND g.capability = 'intake' AND g.valid_from = ${at}))`, params: [expectedRevision, ...reofferOfId === undefined ? [] : [reofferOfId]] },
    writes: (guard) => {
      const notice = notification(target, guard, handoff, "job_handoff_offered", { sql: offerRecipient, params: [handoff] }, ctx.now,
        { sql: "SELECT expires_at FROM job_handoffs WHERE id = ?", params: [handoff] });
      return {
      statements: [
        ...(reofferOfId === undefined ? [] : [
          { sql: `UPDATE job_handoffs SET state = 'expired', ended_at = ? WHERE id = ? AND state = 'offered' AND ${guard.sql}`,
            params: [ctx.now, reofferOfId, ...guard.params ?? []] },
          revokeIntake(guard, reofferOfId, ctx.now),
          bumpVisibilityEpoch(guard, { sql: offerRecipient, params: [reofferOfId] }),
        ]),
        scopedStatement(offerAccess, `INSERT INTO job_handoffs (id, job_id, business_id, incumbent_id, recipient_id, issuer_id,
          reoffer_of_id, policy, call_confirmed_at, offered_at, expires_at, state)
          SELECT ?, j.id, j.business_id, j.accountable_foreman_membership_id, recipient.membership_id, scope.account_id,
            ?, ?, ?, ${at}, deadline.expires_at, 'offered' FROM target_job j CROSS JOIN live_scope scope CROSS JOIN recipient CROSS JOIN deadline WHERE ${guard.sql}`,
        handoff, reofferOfId ?? null, policy, urgentCallConfirmed ? ctx.now : null, ...guard.params ?? []),
        { sql: `UPDATE jobs SET revision = revision + 1 WHERE id = ? AND ${guard.sql}`, params: [job, ...guard.params ?? []] },
        addIntakeGrant(target, guard, handoff),
        ...notice.writes,
      ],
      changes: changesFor(ctx.now, job, `${syncJob(false)} UNION ALL ${handoffChanges(offerRecipient, "upsert")}
        UNION ALL ${notice.changes}${reofferOfId === undefined ? "" : ` UNION ALL ${handoffChanges(offerRecipient, "remove")}`}`,
      handoff, handoff, ...notice.params, ...reofferOfId === undefined ? [] : [reofferOfId, reofferOfId]),
      effects: notice.effects,
      topics: [{ kind: "provider-job", opaqueId: job }],
    }; },
  }, handoffReceipt("offered", expectedRevision + 1), { sql: "SELECT revision FROM target_job", expected: expectedRevision });
}

export function planHandoffDecision(ctx: RequestScope, access: SessionAccess, job: string, handoff: string,
  input: Decision, state: "accepted" | "declined" | "withdrawn",
) {
  const { operationId, expectedRevision, payload } = input;
  const target: SessionAccess = { sql: `${access.sql}, target_job AS MATERIALIZED (SELECT * FROM jobs WHERE id = ?),
    offer AS MATERIALIZED (SELECT * FROM job_handoffs WHERE id = ? AND job_id = (SELECT id FROM target_job)),
    recipient AS MATERIALIZED (${foremanScope("m.id = (SELECT recipient_id FROM offer)")})`, params: [...access.params, job, handoff] };
  const withdraw = state === "withdrawn", accept = state === "accepted";
  const audience = withdraw ? "SELECT context_id FROM recipient" : `SELECT context_id FROM (
    ${adminScope("m.business_id = (SELECT business_id FROM offer) AND ((SELECT issuer_id FROM offer) IS NULL OR m.account_id = (SELECT issuer_id FROM offer))")}
    ${accept ? ` UNION ${foremanScope("m.id = (SELECT incumbent_id FROM offer)")}` : ""})`;
  const loser = `SELECT context_id FROM (${offerRecipient})${accept ? ` UNION ${incumbentContext}` : ""}`;
  return planReceipt(ctx, target, {
    command: `jobs.handoff_${state}`, operationId, input: [job, handoff, input], resultRef: handoff,
    authorize: { sql: withdraw
      ? `EXISTS (SELECT 1 FROM offer h WHERE h.issuer_id = scope.account_id AND ${liveProviderHandoff("h.business_id")})`
      : `EXISTS (SELECT 1 FROM recipient f WHERE f.context_id = scope.context_id)` },
    eligible: { sql: `EXISTS (SELECT 1 FROM offer h JOIN target_job j ON j.id = h.job_id
      WHERE j.state = 'open' AND j.revision = ? AND h.state = 'offered' AND h.offered_at <= ${at} AND h.expires_at > ${at}
        AND h.incumbent_id IS j.accountable_foreman_membership_id${withdraw ? "" : ` AND EXISTS (
          SELECT 1 FROM job_grants g WHERE g.job_id = j.id AND g.context_id = scope.context_id AND ${liveIntake("g")})`})`, params: [expectedRevision] },
    writes: (guard) => {
      const notice = notification(target, guard, handoff, `job_handoff_${state}`, { sql: audience }, ctx.now,
        { sql: "?", params: [ctx.now + week] }, job);
      return {
      statements: [
        { sql: `UPDATE job_handoffs SET state = ?, ended_at = ?, decline_reason = ? WHERE id = ? AND ${guard.sql}`,
          params: [state, ctx.now, state === "declined" ? payload.reason ?? null : null, handoff, ...guard.params ?? []] },
        { sql: `UPDATE jobs SET revision = revision + 1${accept ? ", accountable_foreman_membership_id = (SELECT recipient_id FROM job_handoffs WHERE id = ?)" : ""}
          WHERE id = ? AND ${guard.sql}`, params: [...accept ? [handoff] : [], job, ...guard.params ?? []] },
        revokeIntake(guard, handoff, ctx.now),
        bumpVisibilityEpoch(guard, { sql: loser, params: accept ? [handoff, handoff] : [handoff] }),
        ...notice.writes,
      ],
      changes: changesFor(ctx.now, job, `${syncJob(accept)} UNION ${handoffChanges(offerRecipient, "remove")}
        UNION ${notice.changes}${accept ? ` UNION SELECT 'job', ?, context_id, 'upsert', ${at} FROM (${incumbentContext})` : ""}`,
      handoff, handoff, ...notice.params, ...accept ? [job, handoff] : []),
      effects: notice.effects,
      topics: [{ kind: "provider-job", opaqueId: job }],
    }; },
  }, handoffReceipt(state, expectedRevision + 1), { sql: "SELECT revision FROM target_job", expected: expectedRevision });
}

export function readOperation(access: SessionAccess, operation: OperationId): CommandInput<{ context_id: string | null; committedAt: number | null } | undefined> {
  return { statements: [scopedStatement(access, `SELECT scope.context_id, r.committed_at AS committedAt
    FROM acting_session a LEFT JOIN live_scope scope ON scope.account_id = a.account_id
    LEFT JOIN operation_receipts r ON r.account_id = scope.account_id AND r.context_id = scope.context_id AND r.operation_id = ?`, operation)],
  decode: ([result]) => result?.results[0] as { context_id: string | null; committedAt: number | null } | undefined };
}

type SupportInput = RouteResponse<(typeof submitSupportRoute)["input"]>["body"];
type AnonymousSupport = { lookup: CryptoKey; source: string };
const anonymousSupportLimit = 3;
const anonymousSupportWindow = 60 * minute;

function supportEffect(id: string, now: number): CommandStatement {
  return { sql: `SELECT ? AS id, 'support_intake' AS kind, ? AS dedupe_key, ? AS resource_ref, ? AS due_at, ? AS expires_at`,
    params: [crypto.randomUUID(), `support_intake:${id}`, id, now, now + week] };
}

export async function planSupport(ctx: RequestScope, access: SessionAccess | AnonymousSupport, input: SupportInput, encryptionKey?: string) {
  const { payload, operationId } = input;
  const id = crypto.randomUUID();
  const encryption = payload.replyEmail === undefined ? null : await loadDeliveryKey(encryptionKey);
  if (payload.replyEmail !== undefined && !encryption) return null;
  const encrypted = encryption && await sealDelivery(encryption, id, JSON.stringify(payload.replyEmail));
  const params = [id, payload.kind, payload.message, payload.reference ?? null, encrypted, ctx.now];
  const fields = `id, reporter_id, kind, state, message, reported_reference, reply_email_ciphertext, received_at`;
  const projection = "json_object('reference', c.id, 'receivedAt', c.received_at)";
  if ("sql" in access) {
    return planReceipt(ctx, access, {
      command: "access.submit_support", operationId, input, resultRef: id,
      eligible: { sql: "NOT EXISTS (SELECT 1 FROM support_cases WHERE reporter_id = scope.account_id AND operation_id = ?)", params: [operationId] },
      writes: (guard) => ({
        statements: [scopedStatement(access, `INSERT INTO support_cases (${fields}, operation_id)
          SELECT ?, s.account_id, ?, 'open', ?, ?, ?, ?, ? FROM live_scope s WHERE ${guard.sql}`, ...params, operationId, ...guard.params ?? [])],
        effects: supportEffect(id, ctx.now),
      }),
    }, { sql: `SELECT ${projection} FROM support_cases c WHERE c.id = r.result_ref AND c.reporter_id = scope.account_id` });
  }
  return planAnonymousSupport(ctx, access, input, id, fields, params, projection);
}

async function planAnonymousSupport(ctx: RequestScope, { lookup, source }: AnonymousSupport, { operationId, expectedRevision, payload }: SupportInput,
  id: string, fields: string, params: unknown[], projection: string,
): Promise<CommandInput<JobCommandResult>> {
  const sourceKey = await mac(lookup, "support-intake-source", source);
  const inputHash = await mac(lookup, "support-intake-input", sourceKey, operationId,
    JSON.stringify([expectedRevision ?? null, payload.kind, payload.message, payload.reference ?? null, payload.replyEmail ?? null]));
  const cutoff = ctx.now - anonymousSupportWindow;
  const committed = { sql: "EXISTS (SELECT 1 FROM support_cases WHERE id = ?)", params: [id] };
  return { statements: [
    { sql: `INSERT INTO support_cases (${fields})
      SELECT ?, NULL, ?, 'open', ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM anonymous_support_receipts WHERE source_key = ? AND operation_id = ?
      ) AND (SELECT count(*) FROM anonymous_support_receipts WHERE source_key = ? AND committed_at > ?) < ?`,
    params: [...params, sourceKey, operationId, sourceKey, cutoff, anonymousSupportLimit] },
    { sql: `INSERT INTO anonymous_support_receipts (source_key, operation_id, input_hash, case_id, committed_at)
      SELECT ?, ?, ?, ?, ? WHERE ${committed.sql}`, params: [sourceKey, operationId, inputHash, id, ctx.now, ...committed.params] },
    recordEffectIntents(committed, supportEffect(id, ctx.now)),
    { sql: `SELECT r.input_hash = ? AS matches_input, ${projection} AS value, r.case_id
      FROM anonymous_support_receipts r JOIN support_cases c ON c.id = r.case_id WHERE r.source_key = ? AND r.operation_id = ?`,
    params: [inputHash, sourceKey, operationId] },
    { sql: `SELECT min(committed_at) + ? AS retry_at FROM anonymous_support_receipts
      WHERE source_key = ? AND committed_at > ? AND NOT EXISTS (
        SELECT 1 FROM anonymous_support_receipts WHERE source_key = ? AND operation_id = ?)`,
    params: [anonymousSupportWindow, sourceKey, cutoff, sourceKey, operationId] },
  ], decode(results) {
    const row = results[3]?.results[0] as { matches_input: number; value: string; case_id: string } | undefined;
    if (row?.matches_input) {
      return { value: row.value, operation: {
        outcome: { operationId, status: row.case_id === id ? "committed" : "replayed", resultRef: row.case_id },
        workKeys: (results[2]?.results as { id: string }[] | undefined)?.map(({ id }) => id) ?? [], topics: [],
      } };
    }
    const rate = results[4]?.results[0] as { retry_at: number | null } | undefined;
    const error: ErrorBody = row ? { code: "OPERATION_ID_REUSED", current: { kind: "operation_id_reused" } }
      : { code: "RATE_LIMITED", ...(rate?.retry_at == null ? {} : { retryAt: rate.retry_at }) };
    return { value: null, error, operation: { outcome: { operationId, status: "rejected", error }, workKeys: [], topics: [] } };
  } };
}

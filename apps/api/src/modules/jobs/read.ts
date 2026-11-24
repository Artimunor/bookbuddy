import type { HomeProjection } from "@bookbuddy/api-contract";
import type { ChangeVersionState, QuoteVersionState } from "@bookbuddy/domain";
import type { CommandStatement } from "../../db/commit";
import { at, currentCheck, displayName, eligibilityStatus, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { routedReviewer } from "../commercial/policy";
import { readyAttachmentSql } from "../media/policy";
import { placeCapability } from "../places/policy";
import { workerHomeOffers } from "../schedule/shifts";
import {
  booking, businessCapability, currentMembership, customerPlaces, handoffJson, headingSql, journey, journeySql,
  memberJson, nextVisitId, placeZone, scopedIntakeIds, scopedJobIds, visitJson,
} from "./projections";
import type { JourneyRow, VisitRow } from "./projections";

const pageSize = 50;
const visitDayMargin = 26 * 60 * 60 * 1000;
type Segment = "active" | "past" | "incoming" | "needs_you";
type View = "whole" | "today" | "intake";
type ReadMode = "home" | "list" | View | "overview";
interface Position { rank: number; time: number; id: string }

export function jobPosition(cursor: string | undefined): Position | null {
  if (!cursor) return { rank: -1, time: 0, id: "" };
  const result = /^(\d+)~(-?\d+)~([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!result) return null;
  const rank = Number(result[1]), time = Number(result[2]);
  return Number.isSafeInteger(rank) && Number.isSafeInteger(time) ? { rank, time, id: result[3]! } : null;
}

function page(items: { position: Position }[]) {
  const hasMore = items.length > pageSize;
  if (hasMore) items.pop();
  const last = items.at(-1)?.position;
  return { hasMore, cursor: hasMore && last ? `${last.rank}~${last.time}~${last.id}` : null };
}

const jsonRows = (projection: string, query: string) => `(SELECT json_group_array(json(payload)) FROM (
  SELECT ${projection} AS payload ${query}))`;
const placePacket = (p: string) => `json_object('placeId', ${p}.id, 'alias', ${p}.alias, 'siteZone', ${p}.site_zone)`;
const position = (r: string) => `json_object('rank', ${r}.rank, 'time', ${r}.time, 'id', ${r}.id)`;
const after = (r: string) => `(${r}.rank, ${r}.time, ${r}.id) > (SELECT rank, time, cursor_id FROM input)`;

const latestQuote = `SELECT q.id FROM quote_versions q WHERE q.job_id = j.id AND q.issued_at <= ${at}
  ORDER BY q.state IN ('issued', 'approved') DESC, q.no DESC LIMIT 1`;
const latestChange = `SELECT c.id FROM change_versions c WHERE c.job_id = j.id AND c.issued_at <= ${at}
  AND c.state IN ('issued', 'approved', 'rejected')
  ORDER BY (c.state = 'issued' AND c.expires_at > ${at}) DESC, c.issued_at DESC, c.id LIMIT 1`;
const pendingReviewAuthority = `review.state = 'pending' AND review.submitted_at <= ${at} AND ${routedReviewer("s", "review")}`;
const pendingReviews = `SELECT j.id AS job_id, review.id, q.no, q.author_id, review.submitted_at, review.due_at,
    'quote' AS kind, q.id AS version_id
  FROM reader s JOIN visible_jobs j ON s.role = 'provider_admin' AND j.state = 'open'
  JOIN quote_versions q ON q.job_id = j.id AND q.state = 'in_review' JOIN commercial_reviews review ON review.quote_version_id = q.id
  WHERE ${pendingReviewAuthority}
  UNION ALL
  SELECT j.id, review.id, c.no, c.author_id, review.submitted_at, review.due_at, 'change', c.id
  FROM reader s JOIN visible_jobs j ON s.role = 'provider_admin' AND j.state = 'open'
  JOIN change_versions c ON c.job_id = j.id AND c.state = 'in_review' JOIN commercial_reviews review ON review.change_version_id = c.id
  WHERE ${pendingReviewAuthority}`;
const liveHandoff = `h.state = 'offered' AND h.offered_at <= ${at} AND h.expires_at > ${at}`;
const stuckHandoff = `(h.state IN ('declined', 'expired') OR (h.state = 'offered' AND h.expires_at <= ${at}))`;
const canApprove = (v: string) => `p.named_approver_id = s.account_id AND s.account_id NOT IN (${v}.author_id, ${v}.publisher_id)
  AND ${placeCapability("p.id", "s.account_id", "approve")}`;
const canBook = placeCapability("p.id", "s.account_id", "book");
const nextProposal = `SELECT w.id FROM visits v JOIN visit_windows w ON w.visit_id = v.id WHERE v.job_id = j.id
  AND v.state IN ('planned', 'booked') AND w.state = 'proposed' AND w.provider_authorized = 1
  AND w.proposed_at <= ${at} AND w.expires_at > ${at}
  AND (w.replaces_window_id IS NULL OR EXISTS (SELECT 1 FROM visit_windows old WHERE old.id = w.replaces_window_id AND old.state = 'confirmed'))
  ORDER BY w.replaces_window_id IS NOT NULL DESC, w.expires_at, w.id LIMIT 1`;

const quotePacket = `json_object('versionId', q.id, 'version', q.no, 'state', q.state, 'minor', q.total_minor,
  'issuedAt', q.issued_at, 'expiresAt', q.expires_at, 'by', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = q.publisher_id),
  'canApprove', ${canApprove("q")})`;
const changePacket = `json_object('versionId', ch.id, 'state', ch.state, 'minor', ch.delta_minor,
  'issuedAt', ch.issued_at, 'expiresAt', ch.expires_at, 'by', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = ch.publisher_id),
  'canApprove', ${canApprove("ch")})`;
const proposalPacket = `json_object('id', offered.id, 'proposedAt', offered.proposed_at, 'expiresAt', offered.expires_at,
  'revised', offered.replaces_window_id IS NOT NULL, 'canBook', ${canBook},
  'by', (SELECT ${displayName("a")} FROM accounts a WHERE a.id = offered.proposed_by))`;
const jobFrom = `JOIN places p ON p.id = j.place_id JOIN businesses b ON b.id = j.business_id
  JOIN operating_areas area ON area.id = b.catchment_id JOIN accounts customer ON customer.id = j.requester_id`;
const todayVisits = (linked: boolean) => jsonRows(visitJson("v", "w"), `FROM visits v JOIN visit_windows w ON w.visit_id = v.id AND w.state = 'confirmed'
  WHERE v.job_id = j.id AND v.state IN ('booked', 'finished') AND w.confirmed_at <= ${at}
    AND (${linked ? "v.id = (SELECT visit_id FROM input) OR ((SELECT visit_id FROM input) IS NULL AND " : ""}
      (w.starts_at < ${at} + ${visitDayMargin} AND w.ends_at > ${at} - ${visitDayMargin})${linked ? ")" : ""})
  ORDER BY v.state = 'finished', w.starts_at, v.id LIMIT ${pageSize}`);

function jobPacket(mode: ReadMode, linked = false): string {
  const detail = mode === "whole" || mode === "today";
  return `json_object(${headingSql("j", placeZone)}, ${journeySql("j", at)},
    'position', ${position("j")}, 'revision', j.revision, 'place', json_object('placeId', p.id, 'alias', p.alias),
    'providerName', b.public_name, 'customerName', CASE WHEN s.role = 'foreman' THEN ${displayName("customer")} END,
    'next', json(CASE WHEN w.id IS NOT NULL THEN ${visitJson("v", "w")} END),
    'finalAt', CASE WHEN j.state <> 'open' THEN (SELECT max(cancelled_at) FROM visits WHERE job_id = j.id) END,
    'foreman', json(${memberJson("j.accountable_foreman_membership_id")}),
    'handoff', json(CASE WHEN s.role = 'provider_admin' AND h.id IS NOT NULL THEN ${handoffJson("h", at)} END),
    'quote', json(CASE WHEN s.role = 'customer' AND q.id IS NOT NULL THEN ${quotePacket} END),
    'change', json(CASE WHEN s.role = 'customer' AND ch.id IS NOT NULL THEN ${changePacket} END),
    'proposal', json(CASE WHEN s.role = 'customer' AND offered.id IS NOT NULL THEN ${proposalPacket} END),
    'approver', CASE WHEN s.role = 'customer' THEN (SELECT ${displayName("a")} FROM accounts a WHERE a.id = p.named_approver_id) END,
    'writeQuote', j.write_quote,
    'openChange', s.role = 'foreman' AND EXISTS (SELECT 1 FROM change_versions ch
      WHERE ch.job_id = j.id AND ch.state = 'issued' AND ch.issued_at <= ${at} AND ch.expires_at > ${at})
    ${mode === "whole" ? `, 'attachmentIds', json(CASE WHEN s.role = 'customer' THEN (
      SELECT json_group_array(attachment_id) FROM (
        SELECT attachment_id FROM request_attachments WHERE job_id = j.id ORDER BY attachment_id)) END)` : ""}
    ${detail ? `, 'today', json(${todayVisits(linked)}),
      'review', json(CASE WHEN s.role = 'provider_admin' AND j.state = 'open' THEN (
        SELECT json_object('kind', candidate.kind, 'versionId', candidate.version_id, 'version', candidate.no,
          'submitted', json_object('at', candidate.submitted_at, 'by', ${displayName("author")}))
        FROM pending_reviews candidate JOIN accounts author ON author.id = candidate.author_id
        WHERE candidate.job_id = j.id
        ORDER BY candidate.due_at, candidate.id LIMIT 1) END),
      'canWithdrawHandoff', s.role = 'provider_admin' AND j.state = 'open' AND (${liveHandoff})
        AND ${businessCapability("s.membership_id", "handoff", at)},
      'address', CASE WHEN s.role = 'foreman' THEN p.normalized_address END,
      'arrival', json(CASE WHEN s.role = 'foreman' THEN json_object('arrangement', coalesce(r.arrival_arrangement, 'to_be_arranged'),
        'contactName', r.arrival_contact_name, 'safeNote', r.safe_note) END)` : ""})`;
}

function intakePacket(detail: boolean): string {
  return `json_object(${headingSql("j", placeZone)}, ${journeySql("j", at)},
    'position', json_object('rank', 0, 'time', h.expires_at, 'id', h.id),
    'revision', j.revision, 'town', area.name, 'customerName', ${displayName("customer")}, 'handoff', ${handoffJson("h", at)}
    ${detail ? `, 'request', json(CASE WHEN r.job_id IS NOT NULL THEN json_object(
      'submitted', json_object('at', r.submitted_at, 'by', ${displayName("customer")}),
      'originalText', r.original_text, 'originalLanguage', r.original_language,
      'attachments', json(${jsonRows(`json_object('attachmentId', a.id, 'durationMs', a.duration_ms,
        'availability', CASE WHEN ${readyAttachmentSql("a")} THEN 'available' ELSE 'unavailable' END)`,
      `FROM request_attachments link JOIN attachments a ON a.id = link.attachment_id
        WHERE link.job_id = j.id ORDER BY link.attachment_id`)})) END)` : ""})`;
}

const jobRowFrom = `JOIN reader s ON 1 ${jobFrom}
  LEFT JOIN requests r ON r.job_id = j.id
  LEFT JOIN visit_windows w ON w.id = j.window_id LEFT JOIN visits v ON v.id = w.visit_id
  LEFT JOIN quote_versions q ON q.id = j.quote_id LEFT JOIN change_versions ch ON ch.id = j.change_id
  LEFT JOIN visit_windows offered ON offered.id = j.proposal_id LEFT JOIN job_handoffs h ON h.id = j.handoff_id`;
const intakeRowFrom = `JOIN job_handoffs h ON h.id = k.id JOIN jobs j ON j.id = h.job_id ${jobFrom}`;
const historySql = `history_events(job_id, record_id, kind, stamp_at, actor_id) AS (
  SELECT * FROM (
    SELECT j.id, j.id, 'requested', r.submitted_at, j.requester_id FROM visible_jobs j JOIN requests r ON r.job_id = j.id
    UNION ALL SELECT j.id, q.id, 'quote_issued', q.issued_at, q.publisher_id FROM visible_jobs j JOIN quote_versions q ON q.job_id = j.id
    UNION ALL SELECT j.id, q.id, 'quote_approved', a.at, a.account_id FROM visible_jobs j
      JOIN quote_versions q ON q.job_id = j.id JOIN approvals a ON a.quote_version_id = q.id AND a.decision = 'approve'
    UNION ALL SELECT j.id, ch.id, 'change_issued', ch.issued_at, ch.publisher_id FROM visible_jobs j JOIN change_versions ch ON ch.job_id = j.id
  )
  UNION ALL SELECT j.id, w.id, CASE WHEN w.replaces_window_id IS NULL THEN 'visit_booked' ELSE 'visit_revised' END,
    w.confirmed_at, w.confirmed_by FROM visible_jobs j JOIN visits v ON v.job_id = j.id JOIN visit_windows w ON w.visit_id = v.id
  UNION ALL SELECT j.id, v.id, 'cancelled', v.cancelled_at, v.cancelled_by FROM visible_jobs j JOIN visits v ON v.job_id = j.id
), history AS (
  SELECT job_id, record_id, kind, stamp_at, actor_id, 0 AS rank, -stamp_at AS time, (kind || '-' || record_id) AS id
  FROM history_events WHERE stamp_at <= ${at}
)`;
const historyPacket = `json_object('jobId', e.job_id, 'recordId', e.record_id, 'kind', e.kind, 'at', e.stamp_at,
  'by', CASE WHEN a.id IS NOT NULL THEN ${displayName("a")} END, 'position', ${position("e")})`;

const eligibilityFrom = `FROM eligibility_checks e WHERE e.business_id = s.business_id AND ${currentCheck("e")}`;
const overviewPacket = `json_object(
  'business', json_object('id', s.business_id, 'publicName', s.business_name, 'state', s.business_state,
    'areaName', s.area_name, 'siteZone', s.site_zone),
  'eligibility', json_object('status', coalesce((SELECT ${eligibilityStatus("e")} ${eligibilityFrom}
    AND e.membership_id IS NULL ORDER BY e.checked_at DESC, e.id LIMIT 1), 'pending'),
    'pendingReviewCount', (SELECT count(*) ${eligibilityFrom} AND e.state = 'pending')),
  'offeredCount', (SELECT count(*) FROM sorted_jobs WHERE state = 'open' AND offered_live),
  'nextReplyAt', (SELECT min(reply_at) FROM sorted_jobs WHERE state = 'open' AND offered_live),
  'unassignedCount', (SELECT count(*) FROM sorted_jobs WHERE state = 'open' AND accountable_foreman_membership_id IS NULL),
  'commercialReviewCount', (SELECT count(*) FROM pending_reviews),
  'bills', json((SELECT json_object('openCount', count(*), 'totalMinor', coalesce(sum(invoice.total_minor), 0), 'currency', 'EUR')
    FROM bills invoice WHERE invoice.business_id = s.business_id AND invoice.state = 'issued' AND invoice.issued_at <= ${at}
      AND NOT EXISTS (SELECT 1 FROM paid_records record WHERE record.bill_id = invoice.id AND record.kind = 'matched'
        AND record.at <= ${at} AND NOT EXISTS (SELECT 1 FROM paid_records successor WHERE successor.prior_id = record.id)))),
  'stuck', json(${jsonRows(`json_object(${headingSql("j", placeZone)}, 'since', coalesce(h.ended_at, h.expires_at),
    'offeredTo', json_extract(${memberJson("h.recipient_id")}, '$.displayName'),
    'accountableForeman', json_extract(${memberJson("j.accountable_foreman_membership_id")}, '$.displayName'))`,
  `FROM sorted_jobs j JOIN job_handoffs h ON h.id = j.handoff_id ${jobFrom}
    WHERE j.state = 'open' AND j.handoff_stuck ORDER BY coalesce(h.ended_at, h.expires_at), j.id LIMIT ${pageSize}`)}))`;

const readScope = `reader AS MATERIALIZED (
  SELECT s.*, ${currentMembership("s", at)} AS membership_id,
    b.public_name AS business_name, b.state AS business_state, area.name AS area_name, area.site_zone,
    (SELECT id FROM job_places p WHERE i.place_id IS NULL OR p.id = i.place_id
      ORDER BY p.site_zone IS NULL, p.owned DESC, p.id LIMIT 1) AS selected_place
  FROM live_scope s CROSS JOIN input i LEFT JOIN businesses b ON b.id = s.business_id
  LEFT JOIN operating_areas area ON area.id = b.catchment_id
  WHERE (i.business_id IS NULL OR (s.role = 'provider_admin' AND s.business_id = i.business_id))
    AND (s.role = 'customer' OR ${currentMembership("s", at)} IS NOT NULL)
    AND (i.place_id IS NULL OR (s.role = 'customer' AND EXISTS (SELECT 1 FROM job_places p WHERE p.id = i.place_id)))
)`;

function read(access: SessionAccess, mode: ReadMode, options: {
  placeId?: string; id?: string; businessId?: string; segment?: Segment; position?: Position;
  link?: { job: string; visit: string };
} = {}): CommandStatement {
  const { placeId = null, id = null, businessId = null, segment = "active", position: cursor = { rank: -1, time: 0, id: "" }, link } = options;
  const detail = mode === "whole" || mode === "today" || mode === "intake";
  const history = mode === "home" || mode === "whole";
  const isOverview = mode === "home" || mode === "overview";
  const jobFilter = detail ? "j.id = (SELECT job_id FROM input)"
    : mode === "home" ? `(s.role <> 'customer' OR j.place_id = s.selected_place)`
    : placeId ? "j.place_id = (SELECT place_id FROM input)" : "1";
  const intakeFilter = mode === "intake" ? "j.id = (SELECT job_id FROM input)"
    : mode === "list" || mode === "home" ? "1" : "0";
  const matching = segment === "past" ? "state <> 'open'" : segment === "needs_you" ? "needs_you" : "state = 'open'";
  const ordered = "rank, time, id";
  const selected = detail ? "SELECT * FROM sorted_jobs" : mode === "list" ? `SELECT * FROM sorted_jobs j
    WHERE ${segment === "incoming" ? "0" : matching} AND ${after("j")} ORDER BY ${ordered} LIMIT ${pageSize + 1}`
    : `SELECT j.* FROM sorted_jobs j WHERE id IN (
      SELECT id FROM (SELECT id FROM sorted_jobs WHERE visit_starts <= ${at} ORDER BY visit_starts, id LIMIT ${pageSize})
      UNION SELECT id FROM (SELECT id FROM sorted_jobs WHERE visit_starts > ${at} ORDER BY visit_starts, id LIMIT ${pageSize})
      ${mode === "home" ? `UNION SELECT id FROM (SELECT id FROM sorted_jobs WHERE state = 'open' AND decision_at IS NOT NULL
        ORDER BY decision_at, id LIMIT ${pageSize})
      UNION SELECT id FROM (SELECT id FROM sorted_jobs WHERE state = 'open' AND write_quote ORDER BY submitted_at, id LIMIT ${pageSize})` : ""}
    ) ORDER BY ${ordered}`;
  const input = link
    ? `SELECT NULL, ${link.job}, NULL, -1, 0, '', ${link.visit}`
    : "VALUES (?, ?, ?, ?, ?, ?, NULL)";

  return scopedStatement(access, `,
    input(place_id, job_id, business_id, rank, time, cursor_id, visit_id) AS (${input}),
    job_places AS MATERIALIZED (${customerPlaces("live_scope", at)}), ${readScope},
    visible_jobs AS MATERIALIZED (SELECT j.* FROM (${scopedJobIds("reader", "job_places", at, jobFilter)}) k JOIN jobs j ON j.id = k.resource_id),
    intake AS MATERIALIZED (
      SELECT h.id, 0 AS rank, h.expires_at AS time FROM (${scopedIntakeIds("reader", at, intakeFilter)}) k
      JOIN job_handoffs h ON h.id = k.resource_id
    ),
    pending_reviews AS MATERIALIZED (${pendingReviews}),
    review_deadlines AS (SELECT job_id, min(due_at) AS due_at FROM pending_reviews GROUP BY job_id),
    job_keys AS MATERIALIZED (
      SELECT j.*, s.role AS audience, r.submitted_at,
        ${link ? `CASE WHEN (SELECT visit_id FROM input) IS NOT NULL THEN (SELECT id FROM visit_windows w
          WHERE w.visit_id = (SELECT visit_id FROM input) AND w.state = 'confirmed') ELSE (${nextVisitId("j", at)}) END`
          : `(${nextVisitId("j", at)})`} AS window_id,
        CASE WHEN s.role = 'customer' THEN (${latestQuote}) END AS quote_id,
        CASE WHEN s.role = 'customer' THEN (${latestChange}) END AS change_id,
        CASE WHEN s.role = 'customer' AND j.state = 'open' THEN (${nextProposal}) END AS proposal_id,
        CASE WHEN s.role = 'provider_admin' THEN (SELECT h.id FROM job_handoffs h WHERE h.job_id = j.id AND h.offered_at <= ${at}
          ORDER BY h.state = 'offered' DESC, h.offered_at DESC, h.id DESC LIMIT 1) END AS handoff_id,
        review.due_at AS review_due,
        s.role = 'foreman' AND j.accountable_foreman_membership_id = s.membership_id AND NOT EXISTS (
          SELECT 1 FROM quote_versions q WHERE q.job_id = j.id AND q.state IN ('issued', 'approved', 'in_review')) AS write_quote
      FROM visible_jobs j CROSS JOIN reader s LEFT JOIN requests r ON r.job_id = j.id
      LEFT JOIN review_deadlines review ON review.job_id = j.id
    ),
    job_order AS (
      SELECT j.*, w.starts_at AS visit_starts, h.expires_at AS reply_at, (${liveHandoff}) AS offered_live, ${stuckHandoff} AS handoff_stuck,
        j.state = 'open' AND j.audience = 'provider_admin'
          AND (j.accountable_foreman_membership_id IS NULL OR (${liveHandoff}) OR ${stuckHandoff} OR j.review_due IS NOT NULL) AS needs_you,
        CASE WHEN j.audience = 'customer' AND j.state = 'open' THEN min(
          coalesce(CASE WHEN q.state = 'issued' AND q.expires_at > ${at} AND ${canApprove("q")} THEN q.expires_at END, 9007199254740991),
          coalesce(CASE WHEN ch.state = 'issued' AND ch.expires_at > ${at} AND ${canApprove("ch")} THEN ch.expires_at END, 9007199254740991),
          coalesce(CASE WHEN offered.id IS NOT NULL AND ${canBook} THEN offered.expires_at END, 9007199254740991)) END AS decision_sort
      FROM job_keys j CROSS JOIN reader s JOIN places p ON p.id = j.place_id
      LEFT JOIN visit_windows w ON w.id = j.window_id LEFT JOIN job_handoffs h ON h.id = j.handoff_id
      LEFT JOIN quote_versions q ON q.id = j.quote_id LEFT JOIN change_versions ch ON ch.id = j.change_id
      LEFT JOIN visit_windows offered ON offered.id = j.proposal_id
    ), sorted_jobs AS MATERIALIZED (
      SELECT *, nullif(decision_sort, 9007199254740991) AS decision_at,
        ${segment === "past" || segment === "needs_you" ? "0" : `CASE WHEN visit_starts <= ${at} THEN 0
          WHEN visit_starts IS NOT NULL OR decision_sort < 9007199254740991 THEN 1 ELSE 2 END`} AS rank,
        ${segment === "past" ? `-coalesce((SELECT max(cancelled_at) FROM visits WHERE job_id = job_order.id), submitted_at, 0)`
          : segment === "needs_you" ? "coalesce(CASE WHEN offered_live OR handoff_stuck THEN reply_at END, review_due, submitted_at, 0)"
          : "coalesce(visit_starts, nullif(decision_sort, 9007199254740991), submitted_at, 0)"} AS time
      FROM job_order
    )${history ? `, ${historySql}` : ""}
    SELECT (SELECT json_object(
      'audience', s.role, 'businessName', s.business_name, 'siteZone', s.site_zone,
      'place', json((SELECT ${placePacket("p")} FROM job_places p WHERE p.id = s.selected_place)),
      'unreadCount', (SELECT count(*) FROM notifications n WHERE n.context_id = s.context_id AND n.read_at IS NULL),
      'offers', json(${mode === "home" ? `CASE WHEN s.role = 'worker'
        THEN ${workerHomeOffers("s.membership_id", "s.business_id")} ELSE '[]' END` : "'[]'"}),
      'jobs', json(${mode === "intake" ? "'[]'" : jsonRows(jobPacket(mode, !!link), `FROM (${selected}) j ${jobRowFrom} ORDER BY j.rank, j.time, j.id`)}),
      'incoming', json(${intakeFilter === "0" ? "'[]'" : jsonRows(intakePacket(mode === "intake"),
        `FROM intake k ${intakeRowFrom} ${mode === "intake" ? "LEFT JOIN requests r ON r.job_id = j.id" : ""}
          WHERE ${mode === "list" ? segment === "incoming" ? after("k") : "0" : "1"}
          ORDER BY k.time, k.id LIMIT ${pageSize + 1}`)}),
      'counts', json_object('active', (SELECT count(*) FROM sorted_jobs WHERE state = 'open'),
        'past', (SELECT count(*) FROM sorted_jobs WHERE state <> 'open'), 'incoming', (SELECT count(*) FROM intake),
        'needsYou', (SELECT count(*) FROM sorted_jobs WHERE needs_you),
        'writeQuote', (SELECT count(*) FROM sorted_jobs WHERE state = 'open' AND write_quote)),
      'live', json(${mode !== "list" || (segment === "active" && cursor.rank < 0) ? "null" : `(SELECT ${jobPacket("list")} FROM sorted_jobs j ${jobRowFrom}
        WHERE j.visit_starts <= ${at} ORDER BY j.visit_starts, j.id LIMIT 1)`}),
      'history', json(${history ? `CASE WHEN s.role = 'customer' THEN ${jsonRows(historyPacket,
        `FROM history e LEFT JOIN accounts a ON a.id = e.actor_id WHERE ${after("e")} ORDER BY e.time, e.id LIMIT ${pageSize + 1}`)} ELSE '[]' END` : "'[]'"}),
      'overview', json(${isOverview ? `CASE WHEN s.role = 'provider_admin' THEN ${overviewPacket} END` : "null"})
    ) FROM reader s${link ? " WHERE EXISTS (SELECT 1 FROM visible_jobs)" : ""}) AS value FROM acting_session`,
  ...(link ? [] : [placeId, id, businessId, cursor.rank, cursor.time, cursor.id]));
}

export const readHome = (access: SessionAccess, placeId?: string) => read(access, "home", { placeId });
export const readJobs = (access: SessionAccess, segment: Segment, position: Position, placeId?: string) =>
  read(access, "list", { segment, position, placeId });
export const readJob = (access: SessionAccess, id: string, view: View, position: Position) =>
  read(access, view, { id, position });

// Compose the regular authorized record read into the opaque-token statement.
// Only trusted SQL expressions reach here; user-supplied tokens remain bound.
export function projectJobLinkSql(job: string, scope: string, visit: string): string {
  return `(SELECT value FROM (${read({
    sql: `WITH live_scope AS (SELECT ${scope}.account_id AS account_id, ${scope}.context_id AS context_id,
      ${scope}.role AS role, ${scope}.business_id AS business_id), acting_session AS (SELECT 1)`,
    params: [],
  }, "whole", { link: { job, visit } }).sql}))`;
}

export function projectIntakeLinkSql(handoff: string, scope: string): string {
  return `(WITH intake_scope AS (SELECT ${scope}.context_id AS context_id, ${scope}.role AS role, ${scope}.business_id AS business_id)
    SELECT ${intakePacket(true)} FROM (SELECT resource_id AS id FROM (
      ${scopedIntakeIds("intake_scope", at, `h.id = ${handoff}`)}
    )) k ${intakeRowFrom} LEFT JOIN requests r ON r.job_id = j.id)`;
}

export const readJobsBusinessOverview = (access: SessionAccess, businessId: string) =>
  read(access, "overview", { businessId });

interface Published {
  versionId: string; minor: number; issuedAt: number; expiresAt: number; by: string; canApprove: number | null;
}
interface Proposed {
  id: string; proposedAt: number; expiresAt: number; revised: number; canBook: number; by: string;
}
interface Heading { jobId: string; reference: string; title: string | null; siteZone: string }
interface Member { membershipId: string; displayName: string }
interface Handoff { handoffId: string; expiresAt: number }
interface Job extends Heading, JourneyRow {
  position: Position; revision: number; place: { placeId: string; alias: string }; providerName: string; customerName: string;
  next: VisitRow | null; finalAt: number | null; foreman: Member | null; handoff: Handoff | null;
  quote: (Published & { version: number; state: QuoteVersionState }) | null;
  change: (Published & { state: ChangeVersionState }) | null; proposal: Proposed | null;
  approver: string | null; writeQuote: number; openChange: number; today?: VisitRow[];
  attachmentIds?: string[] | null;
  address?: string; arrival?: unknown; review?: unknown; canWithdrawHandoff?: number | null;
}
interface Intake extends Heading, JourneyRow {
  position: Position; town: string; customerName: string; handoff: Handoff; revision: number;
  request?: {
    submitted: { at: number; by: string }; originalText: string | null; originalLanguage: string | null;
    attachments: { attachmentId: string; durationMs: number | null; availability: "available" | "unavailable" }[];
  } | null;
}
interface Moment { position: Position; kind: string; jobId: string; recordId: string; at: number; by: string | null }
interface Overview {
  business: unknown; eligibility: unknown; offeredCount: number; nextReplyAt: number | null;
  stuck: (Heading & { since: number; offeredTo: string; accountableForeman: string | null })[];
  unassignedCount: number; commercialReviewCount: number;
  bills: { openCount: number; totalMinor: number; currency: "EUR" };
}
export interface ReadRows {
  audience: "customer" | "foreman" | "provider_admin" | "worker"; siteZone: string | null; businessName: string | null; unreadCount: number;
  place: { placeId: string; alias: string; siteZone: string | null } | null;
  offers: Extract<HomeProjection, { audience: "worker" }>["offers"];
  jobs: Job[]; incoming: Intake[]; counts: { active: number; past: number; incoming: number; needsYou: number; writeQuote: number };
  live: Job | null; history: Moment[]; overview: Overview | null;
}

export const decodeJobRows = (value: string) => JSON.parse(value) as ReadRows;
const heading = ({ jobId, reference, title, siteZone }: Heading) => ({ jobId, reference, title, siteZone });
const overviewHeading = (job: Heading) => ({ ...heading(job), title: job.title ?? job.reference });
const action = <Kind extends string>(kind: Kind, recordId: string | null = null, at: number | null = null, waitingOn: string | null = null) =>
  ({ kind, recordId, at, waitingOn });
const isLive = (visit: VisitRow | null, now: number): boolean => !!visit && !visit.finished && visit.startsAt <= now && now < visit.endsAt;
const days = new Map<string, Intl.DateTimeFormat>();

function onSiteDay(visit: VisitRow, siteZone: string, now: number): boolean {
  if (visit.startsAt <= now && now < visit.endsAt) return true;
  let formatter = days.get(siteZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: siteZone, year: "numeric", month: "numeric", day: "numeric" });
    days.set(siteZone, formatter);
  }
  const day = formatter.format(now);
  return formatter.format(visit.startsAt) === day || formatter.format(visit.endsAt - 1) === day;
}

function projectBooking(row: VisitRow) {
  // A confirmed window supports the booking status, not a crew/attendance milestone.
  return { ...booking(row), status: "confirmed" as const, step: null, arrival: null, nextUpdateAt: null, source: { at: row.at, by: row.by } };
}

function customerStep(job: Job, now: number) {
  if (job.state !== "open") return null;
  const { quote, proposal, change, next, approver } = job;
  if (change?.state === "issued" && change.expiresAt > now) return change.canApprove
    ? action("review_change", change.versionId, change.expiresAt) : action("wait_for_approver", null, null, approver);
  if (proposal?.revised && proposal.canBook) return action("review_revised_visit", proposal.id, proposal.expiresAt);
  if (quote?.state === "issued" && quote.expiresAt > now) return quote.canApprove
    ? action("review_quote", quote.versionId, quote.expiresAt) : action("wait_for_approver", null, null, approver);
  if (next) return action("visit", next.visitId, next.startsAt);
  if (proposal?.canBook) return action("pick_window", proposal.id, proposal.expiresAt);
  if (quote?.state === "approved") return action("wait_for_windows");
  return action("wait_for_quote");
}

function customerDecisions(job: Job, now: number) {
  if (job.state !== "open") return [];
  const { change, quote, proposal } = job;
  const common = { ...heading(job), place: job.place, journey: journey(job) };
  return [
    ...(quote?.state === "issued" && quote.canApprove && quote.expiresAt > now ? [{ ...common, kind: "review_quote",
      recordId: quote.versionId, amount: { minor: quote.minor, currency: "EUR" }, sent: { at: quote.issuedAt, by: quote.by }, dueAt: quote.expiresAt }] : []),
    ...(change?.state === "issued" && change.canApprove && change.expiresAt > now ? [{ ...common, kind: "review_change",
      recordId: change.versionId, amount: change.minor < 0 ? null : { minor: change.minor, currency: "EUR" },
      sent: { at: change.issuedAt, by: change.by }, dueAt: change.expiresAt }] : []),
    ...(proposal?.canBook ? [{ ...common, kind: proposal.revised ? "review_revised_visit" : "pick_window", recordId: proposal.id,
      amount: null, sent: { at: proposal.proposedAt, by: proposal.by }, dueAt: proposal.expiresAt }] : []),
  ];
}

const foremanStep = (job: Job) => job.state !== "open" ? null : job.next ? action("visit", job.next.visitId, job.next.startsAt)
  : job.writeQuote ? action("write_quote", job.jobId) : null;
const card = (job: Job) => ({ ...heading(job), state: job.state, place: job.place, journey: journey(job),
  nextVisit: job.next && booking(job.next), finalAt: job.finalAt });
const customerCard = (job: Job, now: number) => ({ ...card(job), providerName: job.providerName, nextStep: customerStep(job, now), live: isLive(job.next, now) });
const foremanCard = (job: Job, now: number) => ({ ...card(job), customerName: job.customerName,
  nextStep: foremanStep(job), live: isLive(job.next, now), flags: job.openChange ? ["open_change"] : [] });
const providerCard = (job: Job) => ({ ...card(job), accountableForeman: job.foreman, handoff: job.handoff });
function providerLive(job: Job, now: number) {
  const next = job.next;
  if (!next || !isLive(next, now)) return null;
  return { ...overviewHeading(job), step: "confirmed", since: next.at, sharedBy: null,
    accountableForeman: job.foreman?.displayName ?? null, crewSize: 0 };
}
const customerLive = (job: Job, visit: VisitRow) => ({ ...heading(job), providerName: job.providerName, journey: journey(job),
  crewName: null, visit: projectBooking(visit) });
const foremanLive = (job: Job, visit: VisitRow) => ({ ...heading(job), place: job.place, customerStatus: null, crew: [], visit: projectBooking(visit) });
const incomingCard = (row: Intake) => ({ ...heading(row), town: row.town, customerName: row.customerName,
  handoff: row.handoff, journey: journey(row) });
const moment = ({ at, by, jobId, recordId, kind }: Moment) => ({ at, by, jobId, recordId, kind });

export function projectJobsBusinessOverview(rows: ReadRows, now: number) {
  if (!rows.overview) return null;
  const { business, eligibility, offeredCount, nextReplyAt, stuck, unassignedCount, commercialReviewCount, bills } = rows.overview;
  const upcoming = rows.jobs.find((job) => job.next && job.next.startsAt > now);
  const current = rows.jobs.find((job) => isLive(job.next, now));
  return {
    business, eligibility, unassignedCount, commercialReviewCount, liveJob: current ? providerLive(current, now) : null,
    nextVisit: upcoming ? { ...overviewHeading(upcoming), startsAt: upcoming.next!.startsAt, endsAt: upcoming.next!.endsAt } : null,
    handoffs: { offeredCount, nextReplyAt, stuck: stuck.map((job) => ({ ...job, title: job.title ?? job.reference })) },
    bills,
  };
}

export function projectHome(rows: ReadRows, now: number) {
  const { audience, unreadCount, businessName, siteZone, jobs, incoming, counts } = rows;
  switch (audience) {
    case "customer": return { audience, unreadCount, place: rows.place,
      liveVisits: jobs.flatMap((job) => isLive(job.next, now) ? [customerLive(job, job.next!)] : []),
      decisions: jobs.flatMap((job) => customerDecisions(job, now)).sort((a, b) => a.dueAt - b.dueAt || a.sent.at - b.sent.at),
      upcoming: jobs.filter((job) => job.next && job.next.startsAt > now).map((job) => customerCard(job, now)),
      recent: rows.history.slice(0, pageSize).map(moment),
    };
    case "foreman": {
      const future = jobs.filter((job) => job.next && job.next.startsAt > now);
      const today = future.filter((job) => onSiteDay(job.next!, job.siteZone, now));
      const needsYou = incoming.map((row) => ({ ...heading(row), action: action("accept_job", row.handoff.handoffId, row.handoff.expiresAt) }));
      return { audience, unreadCount, businessName, siteZone, gaps: [],
        liveVisits: jobs.flatMap((job) => isLive(job.next, now) ? [foremanLive(job, job.next!)] : []),
        laterVisits: (today.length ? today : future.slice(0, 1)).map((job) => foremanCard(job, now)),
        needsYou: [...needsYou, ...jobs.flatMap((job) => job.state === "open" && job.writeQuote
          ? [{ ...heading(job), action: action("write_quote", job.jobId) }] : [])],
        needsYouCount: counts.incoming + counts.writeQuote,
      };
    }
    case "provider_admin": return { audience, unreadCount, overview: projectJobsBusinessOverview(rows, now) };
    case "worker": return { audience, unreadCount, businessName, siteZone, assignment: null, offers: rows.offers, openToCoverUntil: null };
  }
}

export function projectJobs(rows: ReadRows, segment: Segment, now: number) {
  const { audience, siteZone, businessName, unreadCount, jobs, incoming, counts } = rows;
  if ((segment === "incoming" && audience !== "foreman") || (segment === "needs_you" && audience !== "provider_admin")) return null;
  const live = rows.live ?? jobs.find((job) => isLive(job.next, now));
  const pagination = page(segment === "incoming" ? incoming : jobs);
  switch (audience) {
    case "customer": return { audience, segment, siteZone: rows.place?.siteZone ?? null, unreadCount, page: pagination,
      activeCount: counts.active, pastCount: counts.past, items: jobs.map((job) => customerCard(job, now)),
      live: live?.next ? customerLive(live, live.next) : null,
    };
    case "foreman": return { audience, businessName, siteZone, unreadCount, page: pagination,
      incomingCount: counts.incoming, activeCount: counts.active, pastCount: counts.past,
      live: live?.next ? { ...heading(live), visit: projectBooking(live.next) } : null,
      list: { segment, items: segment === "incoming" ? incoming.map(incomingCard) : jobs.map((job) => foremanCard(job, now)) },
    };
    case "provider_admin": return { audience, segment, businessName, siteZone, unreadCount, page: pagination,
      needsYouCount: counts.needsYou, activeCount: counts.active, pastCount: counts.past, items: jobs.map(providerCard),
    };
    case "worker": return { audience, segment, siteZone, unreadCount, page: pagination, items: [] };
  }
}

export function projectIntake(row: Intake | undefined) {
  if (!row) return null;
  const request = row.request;
  const voice = request?.attachments.find(({ durationMs }) => durationMs !== null);
  return { audience: "foreman", job: { ...incomingCard(row), view: "intake", revision: row.revision,
    request: request ? {
      submitted: request.submitted, originalText: request.originalText, originalLanguage: request.originalLanguage,
      attachmentIds: request.attachments.map(({ attachmentId }) => attachmentId), translation: null,
      photos: request.attachments.flatMap(({ attachmentId, durationMs, availability }) => durationMs === null ? [{ attachmentId, availability }] : []),
      originalVoice: voice ? { ...voice, language: request.originalLanguage } : null,
    } : null,
    reply: "available", chatThreadId: null } };
}

export function projectJob(rows: ReadRows, view: View, now: number, exactVisit = false) {
  const { audience } = rows;
  if (view === "intake") return audience === "foreman" ? projectIntake(rows.incoming[0]) : null;
  const job = rows.jobs[0];
  if (!job) return null;
  const today = job.state === "cancelled" ? undefined : exactVisit ? job.today?.[0]
    : job.today?.find((visit) => isLive(visit, now)) ?? job.today?.find((visit) => onSiteDay(visit, job.siteZone, now));
  switch (audience) {
    case "customer": {
      const { quote, change } = job;
      if (view === "today") return today ? { audience, job: { ...customerLive(job, today), view,
        nextStep: customerStep(job, now), crewNames: [] } } : null;
      const pagination = page(rows.history);
      return { audience, job: { ...customerCard(job, now), view, revision: job.revision, hasTodayView: !!today,
        attachmentIds: job.attachmentIds ?? [],
        quote: quote && { versionId: quote.versionId, version: quote.version, state: quote.state, total: { minor: quote.minor, currency: "EUR" } },
        change: change && { versionId: change.versionId, state: change.state, delta: { minor: change.minor, currency: "EUR" } },
        foremanName: job.foreman?.displayName ?? null, chatThreadId: null, openCase: null, bill: null,
        history: { items: rows.history.map(moment), page: pagination },
      } };
    }
    case "foreman": return view === "today" ? today && { audience, job: { ...foremanLive(job, today), view,
      revision: job.revision, gap: null, nextStep: foremanStep(job) } } : { audience, job: {
      ...foremanCard(job, now), view, revision: job.revision, address: job.address, arrival: job.arrival, chatThreadId: null,
    } };
    case "provider_admin": return view === "today" ? today && { audience, job: { ...providerCard(job), view, live: providerLive(job, now) } }
      : { audience, job: { ...providerCard(job), view, revision: job.revision, bill: null, commercialReview: job.review,
        canWithdrawHandoff: Boolean(job.canWithdrawHandoff), handoffPreview: null } };
    case "worker": return null; // No confirmed assignment can exist before staffing is installed.
  }
}

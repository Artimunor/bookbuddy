import type {
  acceptOfferRoute, declineOfferRoute, dropoutAssignmentRoute, ErrorBody, issueAssignmentOfferRoute, RouteResponse, withdrawOfferRoute,
} from "@bookbuddy/api-contract";
import type { CommandInput, CommandStatement } from "../../db/commit";
import { planOperation } from "../../db/operations";
import type { OperationResult, OperationSpec, OperationWrites } from "../../db/operations";
import type { RequestScope } from "../../db/scope";
import { accessClock, at, displayName, scopedStatement } from "../access/policy";
import type { SessionAccess } from "../auth/session";
import { currentMembership } from "../jobs/projections";
import { createLinkTarget, linkTokenFor, registerLinkResolver } from "../links";
import { calendarDay } from "../schedule/calendar";
import { jobOpen } from "../schedule/policy";
import { crewAvailabilityKind, workerAgendaKind } from "../schedule/projections";
import { openGapStatements } from "./cover";
import {
  activeGap, approvedJob, canStaff, fitAvailability, liveAssignment, namedOfferJson, ordinaryFitRows, shiftTarget,
  span, staffingForeman, tags,
} from "./crew";

interface Bodies {
  issue: RouteResponse<typeof issueAssignmentOfferRoute.input>["body"];
  accept: RouteResponse<typeof acceptOfferRoute.input>["body"];
  decline: RouteResponse<typeof declineOfferRoute.input>["body"];
  withdraw: RouteResponse<typeof withdrawOfferRoute.input>["body"];
  dropout: RouteResponse<typeof dropoutAssignmentRoute.input>["body"];
}
type Verb = keyof Bodies;
type Action = { [V in Verb]: { verb: V; body: Bodies[V] } }[Verb];
type Transition = Pick<OperationSpec, "eligible" | "writes">;

const inputId = "(SELECT id FROM ordinary_input)";
const slotId = "(SELECT slot_id FROM ordinary_target)";
const offerLink = "assignment_offer";
const actorName = (account: string) => `(SELECT ${displayName("a")} FROM accounts a WHERE a.id = ${account})`;
const ownedByWorker = (scope: string, g: string, member: string) => `(${scope}.role = 'worker' AND ${scope}.business_id = ${g}.business_id
  AND ${member} = ${currentMembership(scope, at)})`;

function slotTarget(where: string) {
  return `SELECT g.*, slot.id AS slot_id FROM shift_slots slot JOIN (${shiftTarget("1")}) g ON g.shift_id = slot.shift_id WHERE ${where}`;
}

const shiftOpen = (g: string) => `(${jobOpen(g)} AND ${approvedJob(g)} AND ${g}.visit_state = 'booked'
  AND ${g}.shift_state = 'planned' AND ${g}.starts_at > ${at})`;
// A dropout is always handled as cover for that slot. Safety/delivery closure
// must not make it possible to bypass the cover cutoff with an ordinary offer.
const ordinaryVacant = (g: string) => `(${shiftOpen(g)} AND NOT ${liveAssignment(`${g}.slot_id`)}
  AND NOT EXISTS (SELECT 1 FROM cover_gaps cg WHERE cg.slot_id = ${g}.slot_id))`;
const unanswered = (o: string) => `(${o}.state = 'offered' AND ${o}.issued_at <= ${at} AND ${o}.expires_at > ${at})`;
const effectiveState = (o: string, g: string) => `CASE WHEN ${o}.state <> 'offered' THEN ${o}.state
  WHEN ${o}.expires_at <= ${at} THEN 'expired' WHEN NOT ${ordinaryVacant(g)} THEN 'withdrawn' ELSE 'offered' END`;
const endedOffer = (o: string, g: string, state: string, ended: string) => `json_object('kind', 'assignment', 'state', ${state},
  'offerId', ${o}.id, 'endedAt', ${ended}, 'siteZone', ${g}.site_zone)`;
const confirmedOffer = (o: string, g: string) => `(SELECT json_object('kind', 'assignment', 'state', 'confirmed', 'offerId', ${o}.id,
  'assignmentId', a.id, 'shiftId', ${g}.shift_id, 'confirmedAt', a.confirmed_at, 'confirmedByName', ${actorName("a.confirmed_by")},
  'siteZone', ${g}.site_zone) FROM assignments a WHERE a.id = ${o}.assignment_id)`;

function workerOffer(o: string, g: string) {
  const availability = `(SELECT ${fitAvailability("f")} FROM (${ordinaryFitRows(g, `m.id = ${o}.recipient_id`)}) f)`;
  return `CASE ${effectiveState(o, g)} WHEN 'confirmed' THEN ${confirmedOffer(o, g)}
    WHEN 'offered' THEN json_object('kind', 'assignment', 'state', 'offered', 'offerId', ${o}.id, 'town', ${g}.town,
      'task', ${g}.task, 'skill', ${g}.skill, 'briefingLanguage', ${g}.briefing_language, 'siteZone', ${g}.site_zone,
      'window', ${span(g)}, 'replyBy', ${o}.expires_at, 'foremanName', ${actorName(`${o}.issued_by`)},
      'businessName', ${g}.business_name, 'sentAt', ${o}.issued_at, 'workingLanguages', json(${tags("member_languages", `${o}.recipient_id`)}),
      'availability', json(coalesce(${availability}, json_object('state', 'unknown'))))
    WHEN 'expired' THEN ${endedOffer(o, g, "'expired'", `${o}.expires_at`)}
    WHEN 'declined' THEN ${endedOffer(o, g, "'declined'", `${o}.resolved_at`)}
    ELSE ${endedOffer(o, g, "'withdrawn'", `coalesce(${o}.resolved_at, max(${o}.issued_at, min(${at}, coalesce(${g}.cancelled_at, ${at}))))`)} END`;
}

function ownedOpening(id: string, scope: string) {
  return `(SELECT ${workerOffer("o", "g")} FROM assignment_offers o JOIN (${slotTarget("1")}) g ON g.slot_id = o.slot_id
    WHERE o.id = ${id} AND o.issued_at <= ${at} AND ${ownedByWorker(scope, "g", "o.recipient_id")})`;
}

export function readAssignmentOffer(session: SessionAccess, now: number, id: string): CommandStatement {
  return scopedStatement(accessClock(session, now), `SELECT (SELECT ${ownedOpening("?", "scope")}
    FROM live_scope scope) AS value FROM acting_session`, id);
}

registerLinkResolver(offerLink, {
  targetKind: "offer",
  project: (resource, scope) => `(SELECT json_object('kind', '${offerLink}', 'offer', json(value))
    FROM (SELECT ${ownedOpening(resource, scope)} AS value LIMIT 1) WHERE value IS NOT NULL)`,
});

const fromOffer = `FROM ordinary_target g JOIN assignment_offers o ON o.id = ${inputId} AND o.slot_id = g.slot_id`;
const offerFront = (predicate: string) => `EXISTS (SELECT 1 ${fromOffer} WHERE ${predicate})`;
const fromAssignment = `FROM ordinary_target g JOIN assignments a ON a.id = ${inputId} AND a.slot_id = g.slot_id`;
const assignmentFront = (predicate: string) => `EXISTS (SELECT 1 ${fromAssignment} WHERE ${predicate})`;
const canAnswer = (o: string, g: string) => `${unanswered(o)} AND ${ordinaryVacant(g)}`;

// Resolve recipients in the same transaction. Notice links, changes and pushes
// carry only a context and an opaque key, never candidate details or reasons.
const workerContext = (member: string, business: string) => `FROM memberships m
  JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'worker' AND r.granted_at <= ${at} AND r.revoked_at IS NULL
  JOIN account_contexts c ON c.role_grant_id = r.id
  WHERE m.id = ${member} AND m.business_id = ${business} AND m.state = 'active'`;
const accountableContext = `FROM ordinary_target g JOIN memberships m ON m.id = g.accountable_foreman_membership_id
  JOIN accounts a ON a.id = m.account_id AND a.state = 'active'
  JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'foreman' AND r.granted_at <= ${at} AND r.revoked_at IS NULL
  JOIN account_contexts c ON c.role_grant_id = r.id WHERE m.business_id = g.business_id AND m.state = 'active'
    AND c.id IS NOT (SELECT context_id FROM live_scope)`;
const jobResource = "(SELECT id FROM ordinary_target)";
const biz = "(SELECT business_id FROM ordinary_target)";
const offerRecipient = (offer: string) => `(SELECT recipient_id FROM assignment_offers WHERE id = ${offer})`;

function transitionSignals(access: OrdinaryAccess, guard: CommandStatement, options: {
  kind: string; resource: string; link: "assignment_offer" | "job_update" | "cover"; recipient: string;
  member: string; offerExpiry?: string; assignmentChanged?: boolean;
}): OperationWrites {
  const { kind, resource, link, recipient, member, offerExpiry, assignmentChanged } = options;
  const id = crypto.randomUUID();
  const destinations = scopedStatement(access, `SELECT '${link}' AS kind, ${resource} AS resource_id, c.id AS required_scope,
    max(${at} + ${calendarDay}, ${offerExpiry ?? at}) AS expires_at ${recipient}`);
  const token = linkTokenFor("t.kind", "t.resource_id", "t.required_scope", "t.expires_at");
  return {
    statements: [createLinkTarget(destinations, guard), {
      sql: `INSERT INTO notifications (id, context_id, event_key, kind, link_token, created_at)
        SELECT ?, t.required_scope, ?, ?, ${token}, ? FROM (${destinations.sql}) t WHERE ${guard.sql}`,
      params: [id, id, kind, access.now, ...destinations.params ?? [], ...guard.params ?? []],
    }],
    changes: scopedStatement(access, `SELECT 'notification' AS kind, n.id AS resource_id, n.context_id AS partition_key, 'upsert' AS op, ${at} AS at
      FROM notifications n WHERE n.id = ? UNION ALL
      SELECT '${workerAgendaKind}', m.id, c.id, 'upsert', ${at} ${workerContext(member, biz)}${assignmentChanged ? ` UNION ALL
      SELECT '${crewAvailabilityKind}', m.id, c.id, 'upsert', ${at} ${workerContext(member, biz)}` : ""}`, id),
    effects: scopedStatement(access, `SELECT 'push-' || n.id AS id, 'notification_push' AS kind,
      'notification_push:' || n.id AS dedupe_key, n.id AS resource_ref, ${at} AS due_at,
      ${offerExpiry ?? `${at} + ${calendarDay}`} AS expires_at FROM notifications n WHERE n.id = ?`, id),
  };
}

type OrdinaryAccess = SessionAccess & { now: number };

function issue(access: OrdinaryAccess, payload: Bodies["issue"]["payload"]): Transition {
  const { offerId, recipientMembershipId, replyBy } = payload;
  const key = "(SELECT offer_id FROM issue_input)";
  const recipient = "(SELECT recipient_id FROM issue_input)";
  // No user-selected deadline means the worker has until the shift starts.
  const deadline = "coalesce((SELECT reply_by FROM issue_input), g.starts_at)";
  return {
    eligible: { sql: `EXISTS (SELECT 1 FROM ordinary_target g WHERE ${ordinaryVacant("g")}
      AND ${deadline} > ${at} AND ${deadline} <= g.starts_at AND ${canStaff("g", recipient)}
      AND NOT EXISTS (SELECT 1 FROM assignment_offers o WHERE o.slot_id = g.slot_id AND o.state = 'offered' AND o.expires_at > ${at})
      AND NOT EXISTS (SELECT 1 FROM assignment_offers o WHERE o.id = ${key}))` },
    writes(guard) {
      const notice = transitionSignals(access, guard, { kind: offerLink, resource: key, link: offerLink,
        recipient: workerContext(recipient, biz), member: recipient, offerExpiry: `(SELECT expires_at FROM assignment_offers WHERE id = ${key})` });
      return { ...notice, statements: [
        scopedStatement(access, `UPDATE assignment_offers SET state = 'expired', resolved_at = expires_at
          WHERE slot_id = ${slotId} AND state = 'offered' AND expires_at <= ${at} AND ${guard.sql}`, ...guard.params ?? []),
        scopedStatement(access, `INSERT INTO assignment_offers (id, slot_id, recipient_id, issued_by, issued_at, expires_at, state)
          SELECT ?, g.slot_id, ?, scope.account_id, ${at}, ${deadline}, 'offered'
          FROM ordinary_target g CROSS JOIN live_scope scope WHERE ${guard.sql}`, offerId, recipientMembershipId, ...guard.params ?? []),
        ...notice.statements,
      ] };
    },
  };
}

function accept(access: OrdinaryAccess): Transition {
  const assignment = crypto.randomUUID();
  return {
    eligible: { sql: offerFront(`${canAnswer("o", "g")} AND ${canStaff("g", "o.recipient_id")}`) },
    writes(guard) {
      const notice = transitionSignals(access, guard, { kind: "assignment_confirmed", link: "job_update", resource: jobResource,
        recipient: accountableContext, member: offerRecipient(inputId), assignmentChanged: true });
      return { ...notice, statements: [
        scopedStatement(access, `INSERT INTO assignments (id, slot_id, worker_membership_id, source, state,
          confirmed_by, confirmed_at, starts_at, ends_at) SELECT ?, g.slot_id, o.recipient_id, 'ordinary', 'confirmed',
          scope.account_id, ${at}, g.starts_at, g.ends_at ${fromOffer} CROSS JOIN live_scope scope WHERE ${guard.sql}`,
        assignment, ...guard.params ?? []),
        scopedStatement(access, `UPDATE assignment_offers SET state = 'confirmed', resolved_at = ${at}, assignment_id = ?
          WHERE id = ${inputId} AND ${guard.sql}`, assignment, ...guard.params ?? []),
        { sql: `INSERT INTO safety_holds (id, assignment_id, kind, state) SELECT ?, ?, 'briefing', 'active' WHERE ${guard.sql}`,
          params: [crypto.randomUUID(), assignment, ...guard.params ?? []] },
        ...notice.statements,
      ] };
    },
  };
}

function endOffer(access: OrdinaryAccess, verb: "decline" | "withdraw", reason: string | null): Transition {
  const withdraw = verb === "withdraw";
  const state = withdraw ? "withdrawn" : "declined";
  return {
    eligible: { sql: offerFront(canAnswer("o", "g")) },
    writes(guard) {
      const member = offerRecipient(inputId);
      const notice = transitionSignals(access, guard, { kind: `assignment_${state}`, link: withdraw ? offerLink : "job_update",
        resource: withdraw ? inputId : jobResource, recipient: withdraw ? workerContext(member, biz) : accountableContext, member });
      return { ...notice, statements: [
        scopedStatement(access, `UPDATE assignment_offers SET state = '${state}', resolved_at = ${at}, decline_reason = ?
          WHERE id = ${inputId} AND ${guard.sql}`, reason, ...guard.params ?? []),
        ...notice.statements,
      ] };
    },
  };
}

function dropout(access: OrdinaryAccess, assignmentId: string, payload: Bodies["dropout"]["payload"]): Transition {
  const gap = crypto.randomUUID();
  return {
    eligible: { sql: assignmentFront(`a.state = 'confirmed' AND a.confirmed_at <= ${at} AND a.ends_at > ${at}
      AND ${jobOpen("g")} AND g.visit_state = 'booked' AND g.shift_state IN ('planned', 'active') AND ${activeGap("g.slot_id")} IS NULL
      AND NOT EXISTS (SELECT 1 FROM attendance_events e WHERE e.assignment_id = a.id AND e.kind = 'arrival' AND e.review_state = 'accepted')`) },
    writes(guard) {
      const gapRef = `(SELECT id FROM cover_gaps WHERE prior_assignment_id = ${inputId})`;
      const notice = transitionSignals(access, guard, { kind: "assignment_dropped", link: "cover", resource: gapRef,
        recipient: accountableContext, member: `(SELECT worker_membership_id FROM assignments WHERE id = ${inputId})`, assignmentChanged: true });
      return { ...notice, statements: [
        scopedStatement(access, `UPDATE assignments SET state = 'dropped', dropped_at = ${at},
          dropout_reported_by = (SELECT account_id FROM live_scope), dropout_source = ?, dropout_reason = ?
          WHERE id = ${inputId} AND ${guard.sql}`, payload.source, payload.reason ?? null, ...guard.params ?? []),
        ...openGapStatements(guard, { assignmentId, gapId: gap, droppedAt: access.now }),
        ...notice.statements,
      ] };
    },
  };
}

function resourceSlot(verb: Verb) {
  if (verb === "issue") return inputId;
  const table = verb === "dropout" ? "assignments" : "assignment_offers";
  return `(SELECT slot_id FROM ${table} WHERE id = ${inputId})`;
}

type CommandResult = { operation: OperationResult; value: string | null; error?: ErrorBody };

export async function planOrdinary(ctx: RequestScope, session: SessionAccess, id: string, action: Action): Promise<CommandInput<CommandResult>> {
  const { body, verb } = action;
  const clock = accessClock(session, ctx.now);
  const issueInput = action.verb === "issue" ? action.body.payload : null;
  const access: OrdinaryAccess = { now: ctx.now,
    sql: `${clock.sql}, ordinary_input(id) AS (VALUES (?)), ordinary_target AS MATERIALIZED (${slotTarget(`slot.id = ${resourceSlot(verb)}`)})
      ${issueInput ? ", issue_input(offer_id, recipient_id, reply_by) AS (VALUES (?, ?, ?))" : ""}`,
    params: [...clock.params, id, ...issueInput ? [issueInput.offerId, issueInput.recipientMembershipId, issueInput.replyBy ?? null] : []],
  };
  const foreman = staffingForeman("scope", "g");
  const selfReport = action.verb === "dropout" && action.body.payload.source === "self";
  const authorize = { sql: verb === "issue" ? `EXISTS (SELECT 1 FROM ordinary_target g WHERE ${foreman})`
    : verb === "dropout" ? assignmentFront(`${selfReport ? ownedByWorker("scope", "g", "a.worker_membership_id") : foreman}
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.id = a.worker_membership_id AND m.business_id = g.business_id)`)
    : offerFront(verb === "withdraw" ? `${foreman} AND o.issued_by = scope.account_id
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.id = o.recipient_id AND m.business_id = g.business_id)`
      : ownedByWorker("scope", "g", "o.recipient_id") + ` AND o.issued_at <= ${at}`) };
  const transition = (() => {
    switch (action.verb) {
      case "issue": return issue(access, action.body.payload);
      case "accept": return accept(access);
      case "decline": return endOffer(access, "decline", action.body.payload.reason ?? null);
      case "withdraw": return endOffer(access, "withdraw", null);
      case "dropout": return dropout(access, id, action.body.payload);
    }
  })();
  const command = `ordinary_${verb}`;
  const plan = await planOperation(ctx, { operationId: body.operationId, command, input: { id, body },
    resultRef: issueInput?.offerId ?? id, access, authorize, ...transition });
  const value = verb === "dropout" ? `(SELECT json_object('audience', '${selfReport ? "worker" : "foreman"}', 'assignmentId', a.id,
      'shiftId', g.shift_id, 'state', 'dropped', 'droppedAt', a.dropped_at${selfReport ? "" : ", 'gapId', cg.id"})
      ${fromAssignment} JOIN cover_gaps cg ON cg.prior_assignment_id = a.id)`
    : verb === "issue" ? `(SELECT ${namedOfferJson("o", ", 'state', 'offered'")} FROM assignment_offers o
      WHERE o.id = (SELECT offer_id FROM issue_input))`
    : `(SELECT ${verb === "accept" ? confirmedOffer("o", "g") : verb === "decline" ? endedOffer("o", "g", "'declined'", "o.resolved_at")
      : namedOfferJson("o", ", 'state', 'withdrawn', 'resolvedAt', o.resolved_at")} ${fromOffer})`;
  const response = scopedStatement(access, `SELECT ${value} AS value FROM live_scope scope JOIN operation_receipts r
    ON r.account_id = scope.account_id AND r.context_id = scope.context_id AND r.operation_id = ? AND r.command = ?
    WHERE ${authorize.sql}`, body.operationId, command);
  const resultIndex = plan.statements.length;
  return { statements: [...plan.statements, response], decode(results) {
    const operation = plan.decode(results);
    if (operation.outcome.status === "rejected") return { operation, value: null, error: operation.outcome.error };
    const row = results[resultIndex]?.results[0] as { value: string | null } | undefined;
    return { operation, value: row?.value ?? null };
  } };
}

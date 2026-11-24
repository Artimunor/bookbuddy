# D1 schema review — 2026-11-24 (independent reviewer)

Reviewed committed HEAD `07a3bb800400fec88111a723206308a031aa499f` in isolation. Uncommitted edits were excluded. All schema fixes below can be made in place before deployment.

**High**

1. **A recorded booking has no usable session conversation.** `apps/api/migrations/0012_sessions.sql:394–402` creates a separate thread table, but `0010_conversations.sql:12–27` only permits members and messages under job threads. `apps/api/src/modules/sessions/booking.ts:391–398` creates no thread, although line 126 reads one. A new booker gets a null thread ID; manually creating the row still cannot attach messages. Give the shared conversation model an exclusive job-or-booking FK and provision the booking thread atomically.

2. **Deleting an active safety hold bypasses its clearance rules.** `apps/api/migrations/0008_field.sql:334–351` guards insert and update, not delete. `apps/api/src/modules/field/live.ts:32–35,239–241` treats absence of an active incident hold as unblocked when the briefing is otherwise satisfied. A maintenance deletion can therefore permit work without incident clearance. Reject deletion of active holds; retain the attributed clearance and protect safety evidence until authorized disposal.

3. **Expiry columns can turn malformed deadlines into permanent authority.** `apps/api/migrations/0001_identity.sql:35–38` and `0002_access.sql:171–178,193–197` check ordering but not SQLite storage class. An import that puts nonnumeric text in `expires_at` or `valid_until` passes the comparison because SQLite orders text above numbers. Authentication and grant reads use that same comparison (`apps/api/src/modules/auth/session.ts:63–65`; `access/policy.ts:14–15`). Require integer milliseconds on these fields, allowing NULL only where intended.

**Medium**

4. **A commercial decision does not retain the reading aid used to make it.** `apps/api/migrations/0005_commercial.sql:151–161` stores `reading_artifact_ref` as unconstrained text; `0010_conversations.sql:88–102` blocks artifact updates but not replacement or deletion. The command checks the artifact at acceptance (`apps/api/src/modules/commercial/commands.ts:205–216`), yet later cleanup can leave an immutable decision pointing nowhere. Pin the exact version and artifact by FK and protect referenced content against replacement.

5. **“Append-only” chat entries can be overwritten without a correction.** `apps/api/migrations/0010_conversations.sql:43–64` verifies revision ancestry and rejects updates, but does not guard replacement of an existing entry. A replace-style import can change original text while retaining its ID, revision and existing translations. Reject insert collisions on every immutable entry key, as `0012_sessions.sql:71–78` does for listing versions; keep retention deletion separate.

6. **Construction staffing lacks the same-business guarantee present for session hosts.** `apps/api/migrations/0007_staffing.sql:1–4,39–42,117–122` independently references the slot/gap and worker membership. An erroneous write can consume a provider’s one confirmed slot with another provider’s worker; the staffing read then filters that worker out (`apps/api/src/modules/schedule/read.ts:24–31`). Enforce matching business scope on assignments and both offer types, and match a confirmed offer’s recipient to its assignment.

7. **Address verification depends on an erasable audit marker.** `apps/api/src/modules/places/commands.ts:122–127` records an address change in `access_audit`; `access/policy.ts:17–20` rejects older proofs only while that row exists. `apps/api/migrations/0002_access.sql:248–268` does not protect it from deletion or amendment. Pruning the marker while retaining the earlier proof makes that proof pass the freshness check again. Store the address revision on the place and verification; do not derive current authority from retained audit history.

8. **Free-text arrival notes cannot guarantee that access codes stay out of D1.** `packages/domain/src/access-code.ts:16–19` explicitly excludes bare numbers from its detector. `apps/api/src/modules/places/routes.ts:69–83,103–104` uses it before `places/commands.ts:90–94` persists the note verbatim. A customer entering just their entry PIN can therefore store it. For the “never store” requirement, persist structured non-secret arrangements and the live handoff contact/time rather than relying on a text detector.

9. **Notification fan-out scans every tenant’s notification history.** `apps/api/migrations/0003_transport.sql:47–59` indexes `(context_id,event_key)`, but `apps/api/src/modules/field/live.ts:203–210` and `aftercare/invoice.ts:68–75` look up recipients by `event_key` alone, once for sync and again for push. SQLite reported `SCAN notifications`. Change the unique key order to `(event_key,context_id)`; it preserves pair uniqueness and supports both lookup patterns.

10. **Opening the inbox materializes other tenants’ threads before paging.** `apps/api/src/modules/chat/policy.ts:62–65,86–104`, `chat/read.ts:45–50`, and `chat/routes.ts:40–44` scope the reader after building cursor-wide candidates. The first-page query plan materialized `chat_targets` from the global `(job_id,audience)` range; lazy provisioning also walked the global job-ID range. Start from the reader’s authorized places, memberships or assignments, then page their thread keys before projecting details.

11. **Worker history has no worker-leading index covering historical assignments.** `apps/api/migrations/0007_staffing.sql:34–37` indexes the worker only for `confirmed` rows. The actual Past agenda at `apps/api/src/modules/schedule/shifts.ts:184–195` produced `SCAN a` on `assignments`. Add an unconditional worker-leading history index and drive the query from the scoped worker.

**Checked and OK**

- **Migration order and FKs:** 32 tests passed, 0 failed across eight migration/constraint test files. All 12 applied from empty with foreign keys enabled; `foreign_key_check` was empty. No FK cascades away audit history.
- **Drizzle parity:** Compared all 114 tables for columns, affinities, nullability, defaults, PKs, unique keys, FKs/actions, indexes/partial predicates and normalized CHECK expressions. No drift found; generated columns and autoincrement matched.
- **Single-winner invariants:** Confirmed one cover winner per round, one decision per quote/change version, one confirmed window per visit, one sign-off per job, and one original verified session-attendance result with a nonforking correction chain.
- **D1 statement limits:** Migration SQL has no bound parameters or compound SELECT operators. Largest complete migration: 34,914 bytes; largest stored DDL statement: 2,494 bytes. Sampled generated inbox, agenda and notification statements passed the local D1 limit checks.

**Not covered:** Remote D1/workerd execution, production row counts or billing, every dynamically generated API statement, and changes after the reviewed commit. Query plans are local SQLite evidence, not production latency measurements.
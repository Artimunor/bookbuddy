# Security and D1 review resolution

This ledger covers the 65 numbered findings in the four independent baseline reviews. IDs use each source review’s numbering. Commit references identify the remediation; a fixed code path is not evidence that the controls are deployed. Findings marked **Residual risk** have mitigations but are not closed.

## Auth and session ([review](auth-session.md))

| Finding | Status | Commit(s) and disposition |
| --- | --- | --- |
| SecAuth 1 — stale-tab writes | Fixed | `ccd7d6e660`: portal cookie mutations carry the rendered session and context. A mismatch rejects the write and refreshes identity; tabs also signal session changes. |
| SecAuth 2 — portal sign-out | Fixed | `ccd7d6e660`, `08f22deff5`: account menu and settings expose sign-out, confirm server revocation, and clear private tab state and handoffs. |
| SecAuth 3 — native bearer and push revocation | Fixed | `ccd7d6e660`, `b481fa3d3c`: lock locally, disable push locally, and retain a SecureStore proof usable only to retry revocation. The API revokes the session and its device’s push registration in one batch. An offline device still needs connectivity to complete server revocation. |
| SecAuth 4 — delegation without view authority | Fixed | `e26c637a59`: require live inviter view authority at invitation issue, reissue, and acceptance. |
| SecAuth 5 — approval survives address change | Fixed | `e26c637a59`: retire approval, booking, and request authority on address change and bind protected grants and verification to the address revision. |
| SecAuth 6 — history exposed after re-invite | Fixed | `e26c637a59`: restoring a lapsed view grant starts a new history boundary. |
| SecAuth 7 — backup authority reactivation | Fixed | `e26c637a59`: both foreman-role removal paths retire dependent backup grants. |
| SecAuth 8 — sign-out destroys unresolved work | Fixed | `ccd7d6e660`: separate cache purge from authored work and offer sync, explicit discard, or retention locked to the originating account. Without eligible durable storage, retained work lasts only for the current app process. |
| SecAuth 9 — stored portal command bodies | Fixed | `ccd7d6e660`, `40c601c62a`: keep receipt metadata only, remove legacy bodies, and check the authenticated receipt instead of resending. The message composer uses in-memory text only. |
| SecAuth 10 — overbroad offline bootstrap | Fixed | `b481fa3d3c`, `ccd7d6e660`: allowlist the active context, display name, and necessary preferences; expire the projection after 72 hours independently of the bearer. |
| SecAuth 11 — archive with open commitments | Fixed | `e26c637a59`: open jobs and unresolved cases block archive in the command transaction. |
| SecAuth 12 — labelled credentials in arrival notes | Fixed | `e26c637a59`: reject explicit credential declarations, including nonnumeric values. Free text is not a guarantee that notes contain no secrets (D1 8). |
| SecAuth 13 — support intake quota | Fixed | `949b0a5d32`: cap new cases at 10 per account per rolling day and leave idempotent replays free. |
| SecAuth 14 — unbounded auth JSON | Fixed | `949b0a5d32`, `40c601c62a`: enforce a 16 KiB streaming cap before parsing and keep strict UTF-8 decoding with Worker-compatible options. |
| SecAuth 15 — invitation cooldown bypass | Fixed | `e26c637a59`: count deliveries by business and recipient across invitation IDs and states; withdrawal does not reset the limit. |
| SecAuth 16 — production fake mail | Fixed | `949b0a5d32`: inject the fake transport only from Bun dev; fail closed when Worker bindings request dev mail. |
| SecAuth 17 — future-dated role activates early | Fixed | `ccd7d6e660`: shared session and context checks enforce `granted_at`, including on direct roster reads, bootstrap, and context switching. |
| SecAuth 18 — sockets survive sign-out | Fixed | `949b0a5d32`, `ccd7d6e660`: close the revoked session’s sockets without disconnecting another session in the same scope. If the close RPC fails, hints can continue until the short lease expires; reads already require live authorization. |
| SecAuth 19 — invalid upgrade admission | Residual risk | `949b0a5d32`: reject absent or malformed credentials before Durable Object routing and confine well-formed unknown credentials to one pilot object. The documented Cloudflare ingress rate limit remains unprovisioned. |

## Authorization ([review](authorization.md))

| Finding | Status | Commit(s) and disposition |
| --- | --- | --- |
| Authz 1 — sign-off can issue an unauthorized bill | Fixed | `589f5842ef`: sign-off may issue only when the hint records a live, same-business billing grant at submission. Otherwise the reference stays a hint for an authorized issuer. |
| Authz 2 — stale case stewardship | Fixed | `589f5842ef`: require the configured steward, exact case assignment, and a live internal grant for case access and actions. |
| Authz 3 — case correction disclosed to foreman | Fixed | `589f5842ef`: show only that completion was returned unless an explicitly shared packet is tied to that completion. |
| Authz 4 — Later rollout bypass | Fixed | `949b0a5d32`, `40c601c62a`: check target rollout and caller eligibility on fresh routes, chat, and sync projections. The corrected fixture exercises a withdrawn place grant and a disabled provider. A flag change alone does not reset an existing sync cursor to evict previously cached summaries. |
| Authz 5 — dropped worker sees live visit | Fixed | `ff0636ae92`: require a current confirmed assignment for live detail and sync; keep the separate Past receipt. |
| Authz 6 — linked media has no deadline | Fixed | `b0fabdfac1`: apply 90-day progress and 180-day ordinary media deadlines on closure, account for links and holds, and deny expired reads before sweeping. |
| Authz 7 — clean delta misses grant expiry | Fixed | `b0fabdfac1`: bind the signed cursor to the next relevant grant expiry so it can remove scope and return a fresh snapshot without a data write. |
| Authz 8 — deferral covers undisputed lines | Fixed | `589f5842ef`: command and trigger bind deferral to matching immutable invoice lines and their amount; whole-bill disputes must identify the invoice. |
| Authz 9 — cover after contract withdrawal | Fixed | `ff0636ae92`: recheck approved, unwithdrawn scope at issue, acceptance, and confirmation. |
| Authz 10 — future attendance reaches live status | Fixed | `ff0636ae92`: actual or capture times more than two minutes ahead of receipt go to review without publishing “on site.” Delayed captures can still be accepted. |
| Authz 11 — briefing returns site directions | Rebutted in part | W‑09 requires the address and non-secret arrival directions for confirmed workers; those fields are not offer-recipient data. `ff0636ae92` keeps the briefing online-only and denies former assignees. The free-text limitation is tracked in D1 8. |
| Authz 12 — unpublished staffing status | Fixed | `ff0636ae92`: publish “no crew available” to the customer only from an explicit foreman update for the agreed window, not an internal capacity change. |
| Authz 13 — online-only notes in session sync | Fixed | `949b0a5d32`: use a separate booking summary without venue address, access and arrival notes, or agreement data. |
| Authz 14 — media URL outlives grant | Fixed | `b0fabdfac1`: cap the URL by the effective authorizing grant deadline as well as session and object expiry. |
| Authz 15 — per-version evidence cap bypass | Fixed | `b0fabdfac1`: enforce five stored photos and one voice item across all stages in the final quote/change version write. |
| Authz 16 — unverified media type and duration | Residual risk | `b0fabdfac1`: settlement enforces an 800,000-byte voice limit. R2 size and metadata do not attest the coded stream; trusted MIME and duration validation is not implemented. |
| Authz 17 — push and inbox fail open | Fixed | `b0fabdfac1`: recheck the destination grant for push claim, inbox, and sync, and deny unknown kinds. |

## Client privacy ([review](client-privacy.md))

| Finding | Status | Commit(s) and disposition |
| --- | --- | --- |
| SecClient 1 — missing portal sign-out | Fixed | `ccd7d6e660`, `08f22deff5`: confirm revocation and clear private state across tabs (SecAuth 2). |
| SecClient 2 — mutations use a different tab’s cookie | Fixed | `ccd7d6e660`: bind writes to the rendered session and context and refresh stale tabs (SecAuth 1). |
| SecClient 3 — capture can finish after navigation | Fixed | `ccd7d6e660`: cancel pending capture on unmount, stop late-arriving tracks, and prevent cancelled uploads. |
| SecClient 4 — bare entry PIN in an arrival note | Fixed | `e26c637a59`: the shared arrival-note guard rejects bare PINs, standalone runs of four or more digits, and labelled credentials before persistence. See D1 8 for the scope of the guard. |
| SecClient 5 — private bodies survive reload | Fixed | `ccd7d6e660`, `40c601c62a`: persist only receipt metadata and recover through a lookup; the caller does not restore command text from storage. |
| SecClient 6 — durable cache on shared phones | Fixed | `b481fa3d3c`, `ccd7d6e660`: customer read caches stay in memory; existing durable native staff data requires device authentication to reopen, with memory fallback when device authentication is unavailable. |
| SecClient 7 — push survives offline sign-out | Fixed | `b481fa3d3c`, `ccd7d6e660`: deactivate local push, lock locally, and retry server revocation with a dedicated proof (SecAuth 3). |
| SecClient 8 — stale native status card | Fixed | `b481fa3d3c`: stop cards on definitive removal or denial, not during initial or replacement snapshot loading. |
| SecClient 9 — unresolved work omitted from sign-out count | Fixed | `ccd7d6e660`: include uncertain receipts, queued operations, drafts, and staged evidence; require disposition before discarding the only local record. |
| SecClient 10 — draft expiry deletes uncertain request | Fixed | `1fda55756d`: freeze the operation ID and exact payload before sending. Expiry removes only unsubmitted drafts; legacy uncertain sends use receipt lookup only. |
| SecClient 11 — aged work sends without review | Fixed | `1fda55756d`: surface pending operations and selected uploads at day seven; hold automatic sends at day 30 for explicit send or discard. |
| SecClient 12 — removed photo uploads anyway | Fixed | `1fda55756d`: persist cancellation, block new PUTs, and reconcile an in-flight PUT before deleting its local file. |
| SecClient 13 — no staging cap | Fixed | `1fda55756d`: reserve bytes before copying against the 100 MiB account/device cap across contexts. |
| SecClient 14 — untracked media after crash | Fixed | `1fda55756d`: journal file ownership before copying and reconcile interrupted copies and orphaned files at startup. |
| SecClient 15 — abandoned media outlives draft | Fixed | `1fda55756d`: expire never-submitted draft media with its draft without deleting uncertain transfers. |
| SecClient 16 — searches enter history | Fixed | `ccd7d6e660`: keep place search and return filters in memory rather than in the URL or navigation state. |
| SecClient 17 — missing framing and CSP headers | Fixed in repository | `8f176917e4`: ship static CSP and framing headers with hosting instructions. Deployment must substitute the exact origins and verify the headers on portal and link responses. |
| SecClient 18 — oversize default photo resolution | Fixed | `1fda55756d`, `ccd7d6e660`: both clients re-encode with a 2,048-pixel long edge limit and do not upscale. |

## D1 schema ([review](d1-schema.md))

| Finding | Status | Commit(s) and disposition |
| --- | --- | --- |
| D1 1 — bookings have no usable conversation | Fixed | `47fafcbc84`: bookings reserve the opaque thread ID in the booking row. The shared model enforces exactly one job or booking parent, and the first authorized open provisions the row in the read batch. |
| D1 2 — active safety hold can be deleted | Fixed | `ff0636ae92`: a database trigger rejects deletion of an active hold; clearance remains a separate attributed transition. |
| D1 3 — malformed deadlines can extend authority | Fixed | `e26c637a59`: require integer session and grant deadlines, retaining only the intended null cases. |
| D1 4 — decisions do not pin reading artifacts | Fixed | `b0fabdfac1`: pin the version and exact artifact with foreign keys and protect referenced content against replacement. |
| D1 5 — replace bypasses append-only chat | Fixed | `b0fabdfac1`: reject insert collisions on immutable entry keys, without blocking retention deletions. |
| D1 6 — staffing can cross business scope | Fixed | `ff0636ae92`: enforce same-business assignments and offers and match a confirmed offer’s recipient to its assignment. |
| D1 7 — verification relies on erasable audit history | Fixed | `e26c637a59`: bind proofs and live protected authority to the place’s address revision, independently of audit retention. |
| D1 8 — secret exclusion cannot be guaranteed in free text | Residual risk | `e26c637a59` blocks bare PINs and explicit credential declarations. Arrival instructions still accept free text. Only structured non-secret handoffs would close the stronger storage guarantee. |
| D1 9 — notification fan-out scans global history | Fixed | `b0fabdfac1`: lead the unique pair index with `event_key` to support event fan-out without changing pair uniqueness. |
| D1 10 — inbox candidates span tenants before paging | Fixed | `b0fabdfac1`: derive job and booking inbox keys from authorized reader scopes before paging and projection; local query-plan regressions cover the candidate path. |
| D1 11 — worker history scan | Fixed | `ff0636ae92`: add an unconditional worker-leading assignment index and use it for the scoped Past agenda. |

## Integration evidence and limits

- On `ff688c2b15`, `bun test` ran 343 tests across 53 files: 342 passed and the Later rollout fixture failed because its SQL referenced a nonexistent revoker column. TypeScript passed in six of eight workspaces; API and web reported one error each. Locale validation, the web build, and both Expo exports passed.
- `40c601c62a` corrected the rollout fixture without weakening its assertions or TestD1, matched the Worker decoder option type, and removed the portal composer’s stale stored-body reference. The affected auth and booking suites passed 26/26, API and web typechecks passed 2/2, and the rebuilt portal prerendered 14 documents. Other workspace, locale, and mobile export evidence was reused because these repairs did not change their relevant inputs.
- The schema changes assume a fresh prerelease database. Local checks do not establish remote D1/R2 behavior, production ingress and headers, or physical-device authentication, push, and storage behavior.

# Core flows

Design the next action around who can take it, what they are committing to and what has actually happened. The IDs below refer to the [screen inventory](../screens/inventory.md); they do not imply API routes or a legal operating model. Roles and grants are defined in [Personas and roles](personas-and-roles.md).

## Shared state and offline rules

- **Job stage:** Draft → Request sent → Scoping → Quote ready → Scheduling → Booked → In progress → Awaiting sign-off → Signed off → Closed. Cancelled is shown only after authoritative cancellation. Show separate, named flags for a crew gap, an open change, a disputed item and payment. A declined quote can return to Scoping if the parties continue; history is not overwritten. Do not call a site assessment a booked repair.
- **Assignment status:** Offered → Confirmed (ordinary named assignment after valid worker confirmation), or Offered → Accepted, confirmation required → Confirmed (cover). Declined, Expired, Filled elsewhere and Cannot attend describe different outcomes. A worker reply in chat is none of these. A confirmed worker saying they cannot attend opens a crew gap without automatically cancelling the job.
- **Consequential actions require online confirmation:** submitting a request, approving a quote/change, agreeing a schedule, accepting or replacing an assignment, acknowledging a safety briefing, signing off and paying. Save safe eligible drafts, chat/media and attendance events locally where allowed. Say `Saved on this device · pending sync` until accepted; use a distinct failed state with retry/reconcile. Never imply pending evidence or a payment has arrived. No offline grant, safety clearance or optimistic coverage. Show last confirmed time on stale records.
- **Time and sensitive data:** appointments, shift and offer deadlines use the service location time zone, with the person's local time alongside if different and enabled. Label the common zone once on site logs and chat. Display sensitive access instructions only to authorised assigned users who need them, never in push copy or on an offer; do not cache access secrets. Mark offline details as last confirmed and provide a contact route if someone cannot verify what they need.
- **Release gates:** provider relationship, categories/trades, permissible work arrangements, verification, support coverage, payment authorisation and liability are [unverified] operating decisions. A UI status must never assert those facts on the basis of a chat, an invite or software matching alone. The [product brief, 21 Nov 2026](../../docs/reports/2026-11-21-builders-company-idea.md#open-questions) documents the operating questions.

## 1. Customer request, booking and completion

```mermaid
sequenceDiagram
    participant C as Customer
    participant A as App
    participant F as Named foreman
    C->>A: C-02 Describe in own language with optional photos or voice
    C->>A: C-03 Confirm property and access, then C-04 review and send
    A-->>C: C-05 Request sent, not booked
    A->>F: F-03 Send job intake
    F->>A: Accept handoff and scope the work
    opt Assessment needed first
        F->>A: F-06 Propose assessment window
        A-->>C: C-08 Show proposed assessment window
        C->>A: Confirm assessment only
        F->>A: Record scope after visit
    end
    F->>A: F-04 Publish scope and quote version
    A-->>C: C-06 Review scope, exclusions, total and terms
    C->>A: C-07 Approve the current version
    F->>A: F-06 Propose service windows backed by provider capacity
    A-->>C: C-08 Choose or confirm a proposed window
    C->>A: Confirm the proposed service window
    A-->>C: C-05 Booked after current window is confirmed
    F->>A: Confirm named crew and report actual progress
    A-->>C: C-09 Arrival window, named contact and confirmed crew
    F->>A: F-14 Submit completion and required evidence
    A-->>C: C-10 Awaiting sign-off
    alt Customer signs off on the approved work
        C->>A: Confirm sign-off as the authorised approver
        A-->>C: C-11 Show authorised bill when due, or a hold reason
        opt Payment due and customer authorised to pay
            C->>A: Pay through authorised checkout
            A-->>C: Show confirmed outcome and receipt when available
        end
        A-->>C: Close service when no outstanding actions remain
        C->>A: C-12 Leave optional review after closure
    else Customer reports an issue instead of signing off
        C->>A: C-16 Report what is unresolved
        A-->>C: Show case status without marking the work accepted
    end
```

- Start with a free description and optional photos or original voice. Review before sending; show upload/transcript status separately and keep the original playable. A failed translation is not a failed request. A selected photo that has not uploaded is not attached; wait or let the customer explicitly remove it. An out-of-area property routes to an explanation and local service contact, not a confirmed job.
- C-06 shows the exact original scope and version with its translation, exclusions, line items and total. Approve only the current version as an authorised approver. A customer can ask the foreman to clarify by chat or decline online; only publishing and approving a new version changes the quote. Booking requires an approved quote, an accountable provider and a confirmed capacity-backed window, not a promise about a particular worker.
- C-09 shows the named foreman, the agreed arrival window and customer-visible confirmed crew, plus any separately reported delay. No live GPS, pending candidate names or implied check-in based on a message. When completion arrives, compare evidence with the approved scope/change versions. An issue routes to C-16 instead of forcing sign-off.
- Sign-off and payment are distinct. Show biller, currency, total and amount due only from authorised records; use the payment provider's flow and display processing until the outcome is known. A repeat tap cannot create a second payment; reconcile uncertain outcomes before retry. Show receipt when available. An approved hold is shown on the affected amount; no implied escrow, refund or settlement on a button tap. Invite, never require, a review after service closure.

## 2. Foreman accepts a job and assigns crew

```mermaid
flowchart TD
    Start[Provider admin P-02 routes the job to a named foreman] --> Intake[F-03 Review request, evidence and scope of authority]
    Intake --> Choice{Can own this job?}
    Choice -->|Needs detail| Ask[Ask a question in S-10 while intake remains open]
    Ask --> Intake
    Choice -->|No or no authority| Return[Decline or return to business handoff]
    Choice -->|Accept| Scope[F-04 Own scoping and publish only with authority]
    Scope --> Date[F-06 Plan service window and shift needs]
    Date --> Assign[F-07 or F-16 Choose eligible workers for each shift]
    Assign --> Send[Send named offers and show them as offered until resolved]
    Send --> Result{Valid confirmation received?}
    Result -->|Yes| Crew[F-05 shows confirmed crew and links to briefing if required]
    Result -->|Declined or expired| Gap[F-10 Show the coverage gap]
    Result -->|Waiting| Pending[Show deadline and who still needs to respond]
```

Accepting intake creates accountability, not a price, contract approval, worker assignment or scheduled visit. Eligible skills, language, work authorisation, declared availability and conflicts are separate from a worker's profile visibility. A foreman who also works on the job switches into Worker for their own shift confirmation and attendance.

## 3. Worker confirms, declines or drops out

```mermaid
flowchart TD
    Notice[W-01 or alert links to W-03] --> Review[Review task, provider, site area, site time and response deadline]
    Review --> Valid{Offer current and online?}
    Valid -->|No| Block[Show expired, filled or offline state without allowing acceptance]
    Valid -->|Yes| Decision{Worker response}
    Decision -->|Declines| Decline[W-05 confirm decline and show notification only after send]
    Decision -->|Confirms named offer| Check[Recheck eligibility, shift availability and conflict]
    Check -->|Valid| Assigned[Confirmed shift appears in W-04]
    Check -->|Changed| Block
    Decision -->|Accepts current cover offer| Await[Accepted, confirmation required]
    Await -->|Foreman confirms cover| Assigned
    Assigned --> Change{Can no longer attend?}
    Change -->|Yes| Report[W-05 report dropout to notify foreman and open gap]
    Change -->|No| Brief[W-09 review briefing and job-day actions]
```

An unconfirmed external offer shows the area and relevant task, not precise residential access. For a confirmed shift, `Can't attend` is distinct from declining an offer. If an urgent dropout cannot be sent, state `Foreman not notified` and offer a direct foreman contact route; no queued cancellation should look like a released shift. A reason can be entered without a required public explanation or exposure to the customer.

## 4. Last-minute replacement: own team, then vetted pool

```mermaid
sequenceDiagram
    participant F as Foreman
    participant A as App
    participant W as Eligible candidate
    participant O as Local service
    participant C as Customer
    A-->>F: F-10 Gap from dropout or unresolved shift
    F->>A: Set required task, skills, working language and timing
    F->>A: Check own eligible available team first
    opt Eligible own-team candidate exists
        F->>A: Send an internal offer
        A->>W: W-03 Internal cover offer with expiry
    end
    opt Own team exhausted or recorded urgency cutoff reached
        A-->>F: Unlock F-11 only if approved local provider route exists
        F->>A: Choose match with current task and site eligibility
        A->>W: W-03 External offer through permitted provider
    end
    alt Candidate accepts before expiry
        W->>A: Accept provisionally, not permission to travel or start
        A-->>F: F-12 Accepted, confirmation required
        F->>A: Confirm named worker after eligibility and conflict recheck
        alt Still valid and slot open
            A-->>W: W-04 Confirm assignment and relevant briefing
            A-->>F: Crew confirmed; close other offers for this slot
            A-->>C: C-09 Confirmed arrival roster or timing update
        else No longer eligible, available or slot changed
            A-->>F: Confirm failed; retain gap and explain reason
            A-->>W: Offer closed or returned to pending as appropriate
        end
    else All offers decline or expire, or no permitted route
        A-->>F: No cover confirmed
        F->>O: Escalate or agree a revised plan
        A-->>C: If delivery at risk, notify delay or revised window, not candidate details
    end
```

- Own team first means the external step is unavailable until no internal eligible candidate remains or the system records a justified time cutoff; expire/withdraw outstanding own-team offers before sending external ones. Show skill, required work/briefing language, availability, location and approved legal eligibility for the task, responsible business and time. Language is declared work capability, not nationality. Pending/expired checks cannot pass. External workers are approached only via the authorised local provider/contracting relationship; no public pick-up or customer direction of individual labour.
- Label Offered, Accepted and Confirmed distinctly. A provisional acceptance reserves no permission to travel, access a property or perform work. Final confirmation can apply to only one eligible candidate per gap, rechecking assignment conflicts and current eligibility. Other offers resolve as filled or expired. The new worker needs their own versioned instruction and attendance; prior records are never transferred to them.
- Customer notices name only the confirmed, customer-visible crew and accurate arrival window. If coverage is unresolved and timing materially at risk, say `Crew cover being arranged` and identify the foreman and next update. When scope or timing changes, route through C-08/C-15 as appropriate. Do not promise instant cover or show an external pool to customers.

## 5. Multilingual chat and safety-critical confirmation

```mermaid
sequenceDiagram
    participant X as Customer, foreman or worker
    participant A as App
    participant Y as Authorised reader
    participant F as Foreman
    participant W as Assigned worker
    X->>A: S-10 Send original text or authorised attachment to named audience
    A-->>Y: Show source immediately with translation status
    A-->>Y: Show preferred translation alongside labelled original when available
    opt Source misunderstood or translation inadequate
        Y->>A: Ask for clarification or report translation
        X->>A: Post a correction linked to original
    end
    F->>A: S-11 Issue explicit safety-critical instruction to assigned workers
    A-->>W: Display version, original, translation and briefing requirement privately
    alt Cannot understand, translation uncertain, or offline
        W->>F: Request clarification or a human briefing when possible
        A-->>W: Affected work remains blocked pending confirmed understanding
    else Human briefing where needed and worker can explain back
        W->>F: Explain back the critical points in a language both can verify
        F->>A: Verify understanding for the current version
        W->>A: Explicitly acknowledge that same version online
        A-->>F: Record named person, version and server time
    end
```

- Make audience visible before send: Job conversation versus Crew only. Foreman is the customer's named contact. Show translation first and original immediately below, labelled with language names. A same-language message is shown once. Show `Translation pending` or `Translation unavailable` with the original still readable. Keep the original audio with any transcript/translation. The app may suggest a source language; correcting the label or posting a correction never overwrites the original.
- A read receipt, machine translation or tap on a chat bubble never acknowledges a safety instruction. The assigned worker can ask for clarification or say they do not understand. The foreman arranges a human briefing/verifies understanding and the person acknowledges the specific instruction. If this cannot be verified, the affected work does not start; attendance can still be recorded. On a material revision the previous acknowledgement is kept as history, not applied to the new version. No auto-ack through silence, no acknowledgement on behalf of someone else, and no substitute for qualifications or on-site safety obligations.
- The [chat reference](../screens/shared/S-10-job-chat.svg) shows a worker in the Job conversation; the pinned briefing action is a private viewer-specific cue, not a message or crew record shown to customers. S-11 holds the instruction and confirmation.

## 6. Site attendance and progress photos

```mermaid
flowchart TD
    Shift[W-04 Open authorised confirmed shift] --> Gate[W-09 Review briefing and show any work hold]
    Gate --> In[W-06 Explicitly record arrival / check-in]
    In --> Work{Affected work cleared?}
    Work -->|No| Ask[Record attendance only and resolve briefing with foreman]
    Ask --> Work
    Work -->|Yes| Photo[W-07 Capture and caption optional or required evidence]
    Photo --> Out[W-06 Record departure / check-out]
    Ask --> Out
    In --> Status{Connected and authorised?}
    Photo --> Status
    Out --> Status
    Status -->|Accepted| Log[F-13 Site log shows confirmed event or received photo]
    Status -->|No signal and safe to capture| Queue[Save locally with capture time as pending sync]
    Queue -->|When online| Recheck[Reconcile against shift and order without duplicating events]
    Recheck -->|Accepted| Log
    Recheck -->|Rejected or conflict| Resolve[Explain conflict and keep the evidence visible to its author]
    Log --> Share[Foreman shares only appropriate evidence with customer timeline]
```

- Present check-in and check-out as distinct deliberate events, not background location tracking. Explain when offline that recording arrival is not permission to start work. Preserve the original capture time and the confirmed server receipt; mark late uploads. If checkout follows a locally queued arrival, keep the events ordered and resolve any rejection against the shift rather than inventing a confirmed log. Only the assigned person records their attendance; any allowed correction is visibly recorded, not a replacement of the original event.
- Use the system camera/picker and an accessible text alternative. Review images and captions before upload; warn against people, private items or identifying details unrelated to the work. Site evidence goes to the foreman first. A deliberate share publishes selected completed uploads to the customer, and C-10 distinguishes unavailable or not-yet-received evidence from a finished checklist.

## 7. Changes, cancellations and disputes

```mermaid
flowchart TD
    Need[Foreman identifies variance or customer requests change] --> Draft[F-15 Draft a new scoped version with cost and timing impact]
    Draft --> Review[C-15 Compare before and after with originals]
    Review --> Decision{Authorised customer decision}
    Decision -->|Approve current version| New[Apply change only after server confirmation]
    Decision -->|Reject or ask| Hold[Keep prior scope and hold affected work where needed]
    New -->|Timing affected| Slots[C-08 Confirm revised window]
    New --> Timeline[C-05 and F-05 Record decision and timestamp]
    Hold --> Timeline
    Timeline --> Issue{Issue unresolved?}
    Issue -->|Yes| Case[C-16 Share evidence with local support and get case status]
    Case --> Resolve[Authorised resolution: correction, agreed change or status update]
    Resolve --> Timeline
    Other[C-17 Customer asks to reschedule or cancel] --> Terms[Show terms and whether provider must approve]
    Terms -->|Reschedule| Slots
    Terms -->|Cancellation confirmed| Timeline
```

A change is not a comment. Show original and proposed scope, price delta/new total, who is accountable and the schedule impact before explicit approval. Keep unaffected work under previous approval; visibly hold only work that cannot proceed safely or within scope. Explain when a revised window awaits separate acceptance. The current booking remains until changed or cancelled authoritatively, with any fees explained using the approved terms. A case preserves the record and shows owner, expected next response if known and any explicitly affected work/payment; it does not silently accept work, cancel the job or promise a refund. Back-office review and findings are not mobile tools.

## 8. Later category: book a Pilates class or massage

```mermaid
sequenceDiagram
    participant P as Provider
    participant A as App
    participant C as Customer
    P->>A: L-06 Publish approved session, language, venue, duration and capacity
    C->>A: L-01 Browse active local services
    A-->>C: L-02 Show session detail, access information and cancellation terms
    C->>A: L-03 Choose slot and group size
    A-->>C: Show short hold with expiry in venue time
    C->>A: L-04 Confirm details and any required payment
    alt Capacity and payment outcome confirmed where required
        A-->>C: L-05 Booking with arrival details and service language
        A-->>P: Update roster and occupied capacity
    else Hold expires, capacity changes or payment unresolved
        A-->>C: Show not booked or processing; return to slots only when retry is safe
    end
    opt Customer needs a change
        C->>A: Reschedule through L-03/L-04 or cancel with C-17 terms
    end
```

A private massage slot has one booking; a Pilates class or tour may sell multiple places. Show capacity as relevant, venue date/time plus optional local time, advertised activity language, accessibility information, price, duration and terms. No construction quote, progress photo or sign-off stage by default. After attendance, use C-12 if eligible. Team-run sessions can reuse the assignment/cover sequence only where category-specific vetting and staffing are approved; a provider change or cancellation must be stated accurately, not implied to be covered.

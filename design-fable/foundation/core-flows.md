# Core flows

IDs refer to the [screen inventory](../screens/inventory.md). Where the [reference flows](../../design/foundation/core-flows.md) are right they are reused and this file says so; it redraws only what Beacon changes. Owner decisions applied: the provider contracts with and bills the customer and there is no in-app payment at launch; cover comes only from the provider's own crew; cancelling and rescheduling are free; attendance records no location.

## Shared state rules

- **Journey line (job stage):** Requested → Quoted → Booked → Visit → Signed off → Paid. Cancelled appears only after an authoritative cancellation. A crew gap, an open change, an open problem and a bill are separate flags, not stages.
- **Day line (visit):** Confirmed → On the way → On site → Working → Finished. Each step is a stamp made by a deliberate act: the foreman confirms the crew; the crew lead declares "On my way"; the first crew member checks in; the foreman or lead starts work once any safety hold is cleared; the foreman submits completion.
- **Assignment:** Offered → Accepted (slot reserved, awaiting foreman) → Confirmed. First valid acceptance reserves the slot; only the foreman's confirmation assigns the worker. Declined, Expired, Filled and Can't make it are distinct outcomes.
- **Online for consequences, offline for capture:** sending a request, approving, confirming a window, accepting or confirming cover, acknowledging an instruction and signing off need the server. Drafts, chat, photos and check-in or check-out can be saved on the device and are labelled "Saved on this device · pending sync" until accepted.
- **Live honesty:** every status shows who and when. When freshness cannot be confirmed the capsule goes quiet and says "Last confirmed …". Nothing is inferred from a clock, a place or a chat message.
- **Time:** site time first ("Spain time"), the viewer's time alongside when it differs.

## 1. Customer booking, live tracking and completion

```mermaid
sequenceDiagram
    participant C as Customer
    participant A as App
    participant F as Foreman
    participant W as Crew
    C->>A: C-01 ask bar then C-02 describe in own words with photo or voice
    C->>A: C-03 place and access then C-04 review and send
    A-->>C: C-05 Requested, not booked
    A->>F: F-03 New job
    F->>A: F-04 Publish quote version from the provider
    A-->>C: C-06 Quote with original beneath translation
    C->>A: C-07 Named approver approves the current version
    F->>A: F-06 Propose visit windows backed by crew capacity
    C->>A: C-08 Confirm a window
    A-->>C: C-05 Booked, journey line moves
    F->>A: F-07 Assign own crew and confirm
    A-->>C: C-09 Crew confirmed with names
    opt Customer follows live
        C->>A: C-09 Follow live, starts C-19 or C-20
    end
    F->>A: F-17 or W-10 On the way with arrival band
    A-->>C: C-09 and C-19 On the way, band and countdown
    W->>A: W-06 Deliberate check-in, no location
    A-->>C: C-09 Crew on site
    F->>A: Start work once the safety hold is cleared
    A-->>C: C-09 Working
    F->>A: F-17 Share a photo
    A-->>C: C-09 Photo stamp in Moments
    F->>A: F-14 Wrap up and submit completion
    A-->>C: C-09 Finished, dock becomes Review and sign off
    alt Customer accepts the work
        C->>A: C-10 Sign off via S-17
        A-->>C: C-11 Provider bill and how to pay the provider directly
        F->>A: Provider records payment received
        A-->>C: C-11 Marked paid by provider, journey line complete
        C->>A: C-12 Optional rating
    else Customer reports a problem
        C->>A: C-16 Report a problem
        A-->>C: Case status, work not marked accepted
    end
```

- The request path, quote versions and window confirmation are the reference's flow 1, unchanged. Booking still needs an approved quote and a confirmed window.
- **New in Beacon:** the visit day is live. C-09 replaces the static job-day card; the Live Activity or ongoing notification carries the same capsule outside the app.
- **Bill, not checkout.** At launch C-11 shows the provider's bill, its reference and how to pay the provider directly. The provider records the payment; the app never takes or confirms money. Sign-off and payment stay separate.
- Cancelling or rescheduling (C-17) is free. The sheet says so and still explains whether the provider must agree a new window.

## 2. Last-minute replacement from the provider's own crew

```mermaid
sequenceDiagram
    participant X as Worker dropping out
    participant F as Foreman
    participant A as App
    participant W as Own-crew candidate
    participant C as Customer
    X->>A: W-05 Can't make it, sent online
    A-->>F: F-01 crew gap card and push
    F->>A: F-10 Find cover, choose eligible own-crew workers
    F->>A: Send offers with a reply deadline
    A-->>F: F-18 cover search card starts on the Lock Screen
    A->>W: W-01 and W-03 cover offer with offer clock
    opt Visit start is at risk
        A-->>C: C-09 Cover being arranged, foreman named, next update time
    end
    alt A candidate accepts before the deadline
        W->>A: Accept, slot reserved, do not travel yet
        A-->>F: F-12 Accepted, confirm
        F->>A: Confirm cover after eligibility and conflict recheck
        A-->>W: W-04 Confirmed shift and briefing
        A-->>C: C-09 Crew updated with the new name, window unchanged
    else Nobody in the crew can cover
        A-->>F: F-10 No cover from own crew
        F->>A: F-06 Propose a revised visit
        A-->>C: C-08 New window proposed, free to accept or choose another
    end
```

- **Kept from the reference:** first valid acceptance reserves the slot; the foreman's confirmation assigns the worker; a provisional acceptance is not permission to travel; only one candidate is confirmed per gap; the customer never sees candidates or the dropout reason.
- **Owner decision:** at launch offers go only to the provider's own crew. If none can cover, the provider proposes a revised visit. The vetted pool (F-11) is a later rung of the cover ladder with no launch navigation.
- **New in Beacon:** the search is live. F-10 shows a capsule with offer clocks, and F-18 keeps it on the foreman's Lock Screen. Confirming cover always happens in F-12, never from a system surface.
- The replacement gets their own safety instruction and attendance. Nothing transfers from the worker who dropped out.

## 3. Multilingual chat and the safety briefing

```mermaid
sequenceDiagram
    participant X as Sender
    participant A as App
    participant Y as Reader
    participant F as Foreman
    participant W as Assigned worker
    X->>A: S-10 Send in own language to a named audience
    A-->>Y: Original shown at once with translation status
    A-->>Y: Twin bubble, translation on top and original beneath
    A-->>X: Sent, and which language the reader sees
    opt Translation unclear
        Y->>A: Ask to clarify or report the translation
        X->>A: Post a correction linked to the original
    end
    F->>A: S-11 Issue a versioned safety instruction to named workers
    A-->>W: W-04 hold banner, work blocked, attendance still possible
    F->>W: Human briefing in a language both can verify
    W->>F: Teach-back, explains the points back
    F->>A: S-11 Verify understanding for this version
    W->>A: S-11 Acknowledge the same version online
    A-->>F: Hold cleared, named person, version and server time recorded
```

- This is the reference's flow 5 and its settled rules, unchanged: the hold lasts until the foreman has verified understanding by teach-back **and** the worker has acknowledged that version online. A read receipt, a translation or a tap on a bubble never acknowledges anything. A new version needs a new acknowledgement.
- **New in Beacon:** the twin bubble, a language line under the header ("You read English · Mateo writes Español"), a sent receipt that names the reader's language, and customer-visible stamps inline in the Job conversation so the thread shows what happened as well as what was said.
- The UI ships in English and Portuguese. Message languages are not limited to UI languages. Originals are always kept and shown.

## 4. Deliberate check-in with the optional live shift card

```mermaid
flowchart TD
    Shift["W-04 Live shift, confirmed"] --> Way{"Setting off?"}
    Way -->|Yes| OnWay["W-10 On my way: pick an arrival estimate, no location"]
    OnWay --> Board["Foreman board updates; customer sees the band if this worker is crew lead"]
    Way -->|Already there| Dock["Dock: Check in"]
    Board --> Dock
    Dock --> Sheet["W-06 sheet names the event, time and site"]
    Sheet --> Tap{"Record check-in?"}
    Tap -->|Close| Shift
    Tap -->|Record| Net{"Online?"}
    Net -->|Yes| Recorded["Checked in at 09:14 Spain time"]
    Net -->|No| Queued["Saved on this device, pending sync"]
    Queued -->|Back online| Recorded
    Recorded --> Opt{"Shift card opted in?"}
    Opt -->|First time| Ask["Ask once: keep this shift on your Lock Screen?"]
    Ask -->|Not now| Work
    Ask -->|Show it| Card
    Opt -->|Yes| Card["W-11 Live Activity or W-12 notification starts in the foreground"]
    Opt -->|No| Work["Continue in W-04"]
    Card --> Work
    Work --> Hold{"Safety hold?"}
    Hold -->|Yes| Brief["Hold banner and S-11; card says Safety hold, open app"]
    Brief --> Work
    Hold -->|No| Out["Dock: Check out opens W-06"]
    Out --> Ended["Card ends at check-out, or at 8 hours with Open the app to check out"]
```

- Check-in and check-out are deliberate, two-tap events by the assigned worker. **No location is read or stored.** A geofence, a notification or the shift card never records attendance.
- The shift card is optional and off until the worker says yes. It starts in the foreground right after the check-in tap, so it needs no background permission. It shows the job reference, a site alias, "Since check-in" with an OS timer, and one link, Check out, which opens W-06. It never shows an address, a customer name or a safety all-clear.
- iOS ends a Live Activity after 8 hours. The card then says to open the app; the shift record is unaffected. Dismissing the card or denying notifications never blocks attendance.
- Attendance during a safety hold is allowed and labelled "Attendance only".

## 5. Customer-facing live status, privacy-respecting

```mermaid
flowchart LR
    subgraph Crew["Deliberate crew acts"]
        A1["Foreman confirms crew"]
        A2["Crew lead: On my way with estimate"]
        A3["First check-in"]
        A4["Start work after hold cleared"]
        A5["Foreman shares photo or delay"]
        A6["Foreman submits completion"]
    end
    subgraph Server["Server maps acts to crew-level stamps"]
        M["Customer-visible stamp: state, time, shared by"]
    end
    subgraph Customer["What the customer sees"]
        S1["C-09 capsule and Moments"]
        S2["C-19 Live Activity and Dynamic Island"]
        S3["C-20 Android notification"]
        S4["Web portal live page"]
    end
    subgraph Never["Never leaves the provider"]
        N["Positions, routes, per-worker times, dropout reasons, candidates, crew-only chat"]
    end
    A1 --> M
    A2 --> M
    A3 --> M
    A4 --> M
    A5 --> M
    A6 --> M
    M --> S1
    M --> S2
    M --> S3
    M --> S4
```

- The customer's live view is assembled from six kinds of deliberate act. There is no map, no coordinates and no continuous signal. The arrival band is an estimate the crew lead chose to share, shown with who shared it and when.
- **Crew-level outside:** the customer sees "Crew on site · 09:14", not which worker arrived when. Names shown are the confirmed, customer-visible crew.
- **Stale is stated:** if the band passes with no check-in, C-09 says "No arrival update yet · last update 08:52" and offers Message Mateo. The crew lead is prompted to update. The app never invents "late".
- **Follow live** is the customer's choice per device. Starting needs the app in the foreground or push-to-start on iOS 17.2 or later; it runs for at most 8 hours; updates are sent on stage changes only. S-18 explains what is shown and lets the customer hide details on the Lock Screen.
- Workers read in S-18 exactly what customers can see. Lawful basis and notice wording are [unverified] operating decisions; the design collects no location for this.

## 6. Later category: book a session and follow it on the day

```mermaid
sequenceDiagram
    participant P as Provider
    participant A as App
    participant C as Customer
    P->>A: L-06 Publish session with language, venue, duration and capacity
    C->>A: L-01 Browse then L-02 session detail
    C->>A: L-03 Choose slot and party size
    A-->>C: Short hold with expiry in venue time
    C->>A: L-04 Confirm details, pay the provider at the venue
    alt Capacity confirmed
        A-->>C: L-05 Booking pass with capsule and session line
        A-->>P: Roster and capacity updated
    else Hold expired or capacity changed
        A-->>C: Not booked, remaining places shown
    end
    opt Day of the session
        A-->>C: L-07 Starts in countdown on the Lock Screen if opted in
        P->>A: Host confirms the session is on
        A-->>C: L-05 Today, door time and host
    end
    opt Host cannot attend
        P->>A: L-06 Find cover within the provider's own team
        A-->>C: L-05 Host changed, or a pending change needing consent
    end
```

- The booking mechanics are the reference's flow 8, reused. No quote, sign-off or progress-photo stage. Capacity, hold, booking, payment and staffing each have their own status.
- **New in Beacon:** the session uses the same capsule with a shorter line (Booked → Today → Doors open → In session → Done) and the same system surface. A host change follows the same honesty rules as a crew change.
- Later categories have no launch navigation. Each needs its own provider network and rules before it is switched on.

## Flows reused from the reference without change

| Reference flow | Screens | Beacon differences |
| --- | --- | --- |
| [2. Foreman accepts a job and assigns crew](../../design/foundation/core-flows.md#2-foreman-accepts-a-job-and-assigns-crew) | P-02, F-03, F-04, F-06, F-07, F-16, F-05 | Presentation only: F-05 leads with the journey line and crew dots. |
| [3. Worker confirms, declines or drops out](../../design/foundation/core-flows.md#3-worker-confirms-declines-or-drops-out) | W-01, W-03, W-05, W-04, W-09 | The offer clock, and W-01 as a single capsule with a dock. |
| [7. Changes, cancellations and disputes](../../design/foundation/core-flows.md#7-changes-cancellations-and-disputes) | F-15, C-15, C-08, C-16, C-17 | Cancelling and rescheduling are free. Bills go through the provider. Approved text is never altered. |

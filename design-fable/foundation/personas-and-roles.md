# Personas and roles

The first release focuses on managed repairs and small renovations. The pilot location, size and duration are not yet decided. The repair in Xàbia is a fictional example; until an operating area is approved, use “A local crew” rather than naming a service area in the welcome. The local provider contracts with and bills the customer; BookBuddy coordinates the handoff from customer to foreman and crew. The personas and role limits are **reused from the [reference design](../../design/foundation/personas-and-roles.md)**, which got them right. This file restates them briefly and adds what Beacon changes: what "live" means for each person, and what each person may see of the others. Profiles are design hypotheses, not interview findings. Device mix and field conditions are [unverified].

## Customer personas

| Persona | Goal and friction | What live means for them | Device and situation |
| --- | --- | --- | --- |
| Owner abroad (Claire Martin, UK) | Get a repair done without travelling. Cannot inspect, cannot tell a chat promise from a booking. | "Are they coming, are they there, is it done?" from the Lock Screen, in her own time zone, with photos when the foreman shares them. | iPhone or Android, short glances between other things. Also uses the web portal. Site time and her time side by side. |
| Local owner | Explain the fault fast and plan the day around the visit. | The arrival band and "On site", so they can open the gate at the right moment. | Phone outdoors, sometimes in glare or a dead spot. |
| Property manager | Keep many places and jobs straight; know whose approval is needed. | One Now screen sorted by what is live and what needs a decision, with a place filter. | Phone between properties; weak signal in some buildings. |
| Renovating investor | Track several jobs; compare approved scope with proposed changes. | The journey line per job; changes and bills flagged as decisions. | Phone on a walkthrough or travelling. |

## Provider, crew and later personas

| Persona | Goal and friction | What live means for them | Device and situation |
| --- | --- | --- | --- |
| Foreman (Mateo Ruiz, Reformas Ruiz) | Own the handoff, staff the visit, cover a dropout from his own crew, keep the customer informed. | A board of today's visits with each worker's state, a live cover search, and one tap to tell the customer "on the way". | One-handed Android or iPhone between jobs, in sun and noise. |
| Worker (Nadia Benali, Diego Torres) | Know what is offered, where to be, what must be understood before starting. | One next step: accept, set off, check in, check out. An optional shift card on the Lock Screen after check-in. | Often an older Android, gloves, glare, low battery, patchy signal. Field mode on by default. |
| Provider admin (Mateo, as owner-operator) | Keep named foremen accountable; see who may work. | Stuck handoffs and expiring eligibility surfaced as decisions. | Phone at a desk or between jobs. |
| Later-category provider and customer | Fill a class or slot; book and attend a session. | A countdown to the session and an honest notice if the host changes. | Phone in a studio or on holiday. |

Language is never inferred from nationality, name or address. The UI ships in English (default) and Portuguese. People write messages in any language; the reader sees a translation with the original beneath it.

## Mobile roles and guardrails

A persona describes a need; a role describes what someone may do in a context. A context is a role plus, where relevant, one provider business, and access is checked again per place, job, thread and shift. Switching role changes what the account is acting as, not who is signed in.

| Role | Can do within scope | Must not get by default |
| --- | --- | --- |
| Customer | Request work, follow bookings live at crew level, message the foreman, and follow visits on the Lock Screen. Approving a quote or change, sign-off and managing other people's access are granted per place to a named approver. | No crew staffing, crew-only chat, worker positions, per-worker attendance times, dropout reasons or eligibility documents. Sees only confirmed, customer-visible crew names. |
| Foreman | Own named jobs, scope and quote with business authority, schedule, assign own-crew workers, run a cover search within the provider's crew, confirm cover, lead the safety briefing with teach-back, share updates with the customer. | No access to unrelated jobs or raw eligibility documents. Cannot approve their own quote as the customer. Cannot offer shifts to workers outside the provider's crew at launch. |
| Worker | See and answer their own offers, run their own shift, declare "On my way", check in and out deliberately, send photos to the foreman, acknowledge an instruction after teach-back. | No other workers' data, customer billing, place access details before confirmation, or anyone else's acknowledgement or attendance. Location is not collected. |
| Provider admin | Manage memberships and job ownership in one business; see the minimum status needed for eligibility follow-up; record that a bill was paid. | No automatic foreman or worker access, no customer approvals, no automatic membership of job chats. |

- A small-business owner may be Provider admin, Foreman and Worker. Mateo assigns as Foreman and checks in for his own shift as Worker.
- A property manager is a Customer at their own home and at managed places. Approval rights do not transfer between places.
- An account that wrote a quote cannot approve it from a Customer context.
- **What each side sees of a live visit:** the customer sees the crew's state, the arrival band, confirmed names and shared photos. The foreman sees each worker's state and times. A worker sees their own shift and the foreman's instructions. Nobody sees a map or a position.

## Internal operations (not a mobile role)

The company's local team onboards providers, reviews eligibility and helps with access, disputes and visits that cannot be covered. Mobile users see a status and a way to contact the service, not internal tools. The vetted pool of workers outside a provider's own crew is a later capability run through this team; it is not in the launch navigation.

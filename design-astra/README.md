# BookBuddy mobile design · Astra

This track improves Sol’s repair flows. A customer can follow what the foreman reports about a visit; the worker sees a separate, private shift record. The provider remains responsible for the work and bills the customer directly. Start with the [improvement plan and nine-slice checklist](foundation/improvement-plan.md).

## Foundation

- [Personas and roles](foundation/personas-and-roles.md): who uses the app and what each role can do.
- [Information architecture](foundation/information-architecture.md): role navigation, app entry, context switching and links.
- [Core flows](foundation/core-flows.md): booking, crew coverage, multilingual communication, site work and later sessions.

## Design system and handoff

- [Design system](system/design-system.md): colour, components, platform rules, accessibility and localisation.
- [Wireframe conventions](system/wireframe-conventions.md) and [SVG template](system/wireframe-template.svg): the shared production standard and sample Jobs screen.
- [Shared job-chat reference](screens/shared/S-10-job-chat.svg): translated and original messages in an assigned worker's view.
- Live references: [customer visit](screens/customer/C-18-follow-live.svg), [worker Today](screens/worker/W-01-today.svg), and [iPhone Lock Screen](screens/shared/S-18-live-activity.svg) with [compact](screens/shared/S-18-live-activity--compact.svg), [minimal](screens/shared/S-18-live-activity--minimal.svg) and [expanded](screens/shared/S-18-live-activity--expanded.svg) Island states.
- [Screen inventory](screens/inventory.md): release and later surfaces, states and slice assignments.

## Screens

### Customer

Specs: [customer entry and booking](screens/customer/C-01_C-08-specs.md) · [visit and aftercare](screens/customer/C-09_C-17-specs.md)

| | | |
| --- | --- | --- |
| <img src="screens/customer/C-01-jobs-home.svg" width="240" alt="C-01 Jobs home"><br>C-01 Jobs home | <img src="screens/customer/C-02-describe-the-job.svg" width="240" alt="C-02 Describe the job"><br>C-02 Describe the job | <img src="screens/customer/C-02-describe-the-job--uploading-media.svg" width="240" alt="C-02 Describe the job — uploading media"><br>C-02 Describe the job — uploading media |
| <img src="screens/customer/C-03-property-and-access.svg" width="240" alt="C-03 Property and access"><br>C-03 Property and access | <img src="screens/customer/C-04-review-and-send-request.svg" width="240" alt="C-04 Review and send request"><br>C-04 Review and send request | <img src="screens/customer/C-04-review-and-send-request--offline-unsent.svg" width="240" alt="C-04 Review and send request — offline unsent"><br>C-04 Review and send request — offline unsent |
| <img src="screens/customer/C-05-job-detail-and-timeline.svg" width="240" alt="C-05 Job detail and timeline"><br>C-05 Job detail and timeline | <img src="screens/customer/C-06-quote-and-scope.svg" width="240" alt="C-06 Quote and scope"><br>C-06 Quote and scope | <img src="screens/customer/C-06-quote-and-scope--superseded.svg" width="240" alt="C-06 Quote and scope — superseded"><br>C-06 Quote and scope — superseded |
| <img src="screens/customer/C-07-approve-current-quote.svg" width="240" alt="C-07 Approve current quote [Modal]"><br>C-07 Approve current quote [Modal] | <img src="screens/customer/C-08-schedule-a-visit.svg" width="240" alt="C-08 Schedule a visit"><br>C-08 Schedule a visit | <img src="screens/customer/C-08-schedule-a-visit--window-changed.svg" width="240" alt="C-08 Schedule a visit — window changed"><br>C-08 Schedule a visit — window changed |
| <img src="screens/customer/C-09-job-day.svg" width="240" alt="C-09 Job day"><br>C-09 Job day | <img src="screens/customer/C-09-job-day--crew-replaced.svg" width="240" alt="C-09 Job day — crew replaced"><br>C-09 Job day — crew replaced | <img src="screens/customer/C-10-completion-and-sign-off.svg" width="240" alt="C-10 Completion and sign-off"><br>C-10 Completion and sign-off |
| <img src="screens/customer/C-11-payment-and-receipt.svg" width="240" alt="C-11 Payment and receipt"><br>C-11 Payment and receipt | <img src="screens/customer/C-11-payment-and-receipt--paid.svg" width="240" alt="C-11 Payment and receipt — paid"><br>C-11 Payment and receipt — paid | <img src="screens/customer/C-11-payment-and-receipt--payment-failed.svg" width="240" alt="C-11 Payment and receipt — payment failed"><br>C-11 Payment and receipt — payment failed |
| <img src="screens/customer/C-12-leave-a-review.svg" width="240" alt="C-12 Leave a review [Sheet]"><br>C-12 Leave a review [Sheet] | <img src="screens/customer/C-13-properties.svg" width="240" alt="C-13 Properties"><br>C-13 Properties | <img src="screens/customer/C-14-property-detail-and-people.svg" width="240" alt="C-14 Property detail and people"><br>C-14 Property detail and people |
| <img src="screens/customer/C-15-review-a-job-change.svg" width="240" alt="C-15 Review a job change"><br>C-15 Review a job change | <img src="screens/customer/C-16-report-an-issue-or-follow-a-case.svg" width="240" alt="C-16 Report an issue or follow a case"><br>C-16 Report an issue or follow a case | <img src="screens/customer/C-16-report-an-issue-or-follow-a-case--case-open.svg" width="240" alt="C-16 Report an issue or follow a case — case open"><br>C-16 Report an issue or follow a case — case open |
| <img src="screens/customer/C-17-cancel-or-reschedule.svg" width="240" alt="C-17 Cancel or reschedule"><br>C-17 Cancel or reschedule | <img src="screens/customer/C-18-follow-live.svg" width="240" alt="C-18 Customer visit timeline"><br>C-18 Follow live | |

### Foreman

Specs: [intake and dispatch](screens/foreman/F-01_F-07-specs.md) · [crew and delivery](screens/foreman/F-08_F-16-specs.md). F-11 and its vetted-pool offers are later, not launch navigation.

| | | |
| --- | --- | --- |
| <img src="screens/foreman/F-01-today.svg" width="240" alt="F-01 Today"><br>F-01 Today | <img src="screens/foreman/F-01-today--gap-alert.svg" width="240" alt="F-01 Today — gap alert"><br>F-01 Today — gap alert | <img src="screens/foreman/F-02-jobs.svg" width="240" alt="F-02 Jobs"><br>F-02 Jobs |
| <img src="screens/foreman/F-03-job-intake.svg" width="240" alt="F-03 Job intake"><br>F-03 Job intake | <img src="screens/foreman/F-03-job-intake--reassignment.svg" width="240" alt="F-03 Job intake — reassignment"><br>F-03 Job intake — reassignment | <img src="screens/foreman/F-04-scope-and-quote-editor.svg" width="240" alt="F-04 Scope and quote editor"><br>F-04 Scope and quote editor |
| <img src="screens/foreman/F-04-scope-and-quote-editor--pending-review.svg" width="240" alt="F-04 Scope and quote editor — pending review"><br>F-04 Scope and quote editor — pending review | <img src="screens/foreman/F-05-job-control.svg" width="240" alt="F-05 Job control"><br>F-05 Job control | <img src="screens/foreman/F-06-schedule-and-availability.svg" width="240" alt="F-06 Schedule and availability"><br>F-06 Schedule and availability |
| <img src="screens/foreman/F-06-schedule-and-availability--conflict.svg" width="240" alt="F-06 Schedule and availability — conflict"><br>F-06 Schedule and availability — conflict | <img src="screens/foreman/F-07-assign-crew.svg" width="240" alt="F-07 Assign crew [Sheet]"><br>F-07 Assign crew [Sheet] | <img src="screens/foreman/F-07-assign-crew--ineligible.svg" width="240" alt="F-07 Assign crew [Sheet] — ineligible"><br>F-07 Assign crew [Sheet] — ineligible |
| <img src="screens/foreman/F-08-team-roster.svg" width="240" alt="F-08 Team roster"><br>F-08 Team roster | <img src="screens/foreman/F-09-worker-profile-and-availability.svg" width="240" alt="F-09 Worker profile and availability"><br>F-09 Worker profile and availability | <img src="screens/foreman/F-10-fill-shift.svg" width="240" alt="F-10 Fill shift"><br>F-10 Fill shift |
| <img src="screens/foreman/F-10-fill-shift--offers-pending.svg" width="240" alt="F-10 Fill shift — offers pending"><br>F-10 Fill shift — offers pending | <img src="screens/foreman/F-11-vetted-pool.svg" width="240" alt="F-11 Vetted pool"><br>F-11 Vetted pool | <img src="screens/foreman/F-11-vetted-pool--no-match.svg" width="240" alt="F-11 Vetted pool — no match"><br>F-11 Vetted pool — no match |
| <img src="screens/foreman/F-11-vetted-pool--offers-pending.svg" width="240" alt="F-11 Vetted pool — offers pending"><br>F-11 Vetted pool — offers pending | <img src="screens/foreman/F-12-confirm-replacement.svg" width="240" alt="F-12 Confirm replacement [Sheet]"><br>F-12 Confirm replacement [Sheet] | <img src="screens/foreman/F-12-confirm-replacement--already-filled.svg" width="240" alt="F-12 Confirm replacement [Sheet] — already filled"><br>F-12 Confirm replacement [Sheet] — already filled |
| <img src="screens/foreman/F-13-site-log.svg" width="240" alt="F-13 Site log"><br>F-13 Site log | <img src="screens/foreman/F-14-submit-completion.svg" width="240" alt="F-14 Submit completion"><br>F-14 Submit completion | <img src="screens/foreman/F-15-propose-job-change.svg" width="240" alt="F-15 Propose job change"><br>F-15 Propose job change |
| <img src="screens/foreman/F-16-shift-detail.svg" width="240" alt="F-16 Shift detail"><br>F-16 Shift detail |  |  |

### Worker

Specs: [worker shifts and attendance](screens/worker/W-01_W-09-specs.md)

| | | |
| --- | --- | --- |
| <img src="screens/worker/W-01-today.svg" width="240" alt="W-01 Today"><br>W-01 Today | <img src="screens/worker/W-01-today--rtl-arabic.svg" width="240" alt="W-01 Today — rtl arabic"><br>W-01 Today — rtl arabic | <img src="screens/worker/W-02-my-shifts.svg" width="240" alt="W-02 My shifts"><br>W-02 My shifts |
| <img src="screens/worker/W-03-offer-details.svg" width="240" alt="W-03 Offer details"><br>W-03 Offer details | <img src="screens/worker/W-03-offer-details--awaiting-confirmation.svg" width="240" alt="W-03 Offer details — awaiting confirmation"><br>W-03 Offer details — awaiting confirmation | <img src="screens/worker/W-03-offer-details--filled-elsewhere.svg" width="240" alt="W-03 Offer details — filled elsewhere"><br>W-03 Offer details — filled elsewhere |
| <img src="screens/worker/W-04-shift-detail.svg" width="240" alt="W-04 Shift detail"><br>W-04 Shift detail | <img src="screens/worker/W-05-decline-or-drop-out.svg" width="240" alt="W-05 Decline or drop out [Sheet]"><br>W-05 Decline or drop out [Sheet] | <img src="screens/worker/W-06-check-in-or-out.svg" width="240" alt="W-06 Check in or out [Sheet]"><br>W-06 Check in or out [Sheet] |
| <img src="screens/worker/W-06-check-in-or-out--outside-geofence-large-text.svg" width="240" alt="W-06 Check in or out [Sheet] — outside geofence large text"><br>W-06 Check in or out [Sheet] — outside geofence large text | <img src="screens/worker/W-07-add-progress-photos.svg" width="240" alt="W-07 Add progress photos"><br>W-07 Add progress photos | <img src="screens/worker/W-07-add-progress-photos--queued-offline.svg" width="240" alt="W-07 Add progress photos — queued offline"><br>W-07 Add progress photos — queued offline |
| <img src="screens/worker/W-08-availability.svg" width="240" alt="W-08 Availability"><br>W-08 Availability | <img src="screens/worker/W-09-site-briefing.svg" width="240" alt="W-09 Site briefing"><br>W-09 Site briefing |  |

### Shared

Specs: [access and inboxes](screens/shared/S-01_S-09-specs.md) · [communication, safety and system status](screens/shared/S-11_S-17-specs.md)

| | | |
| --- | --- | --- |
| <img src="screens/shared/S-01-welcome-and-app-language.svg" width="240" alt="S-01 Welcome and app language"><br>S-01 Welcome and app language | <img src="screens/shared/S-02-sign-in-or-create-account.svg" width="240" alt="S-02 Sign in or create account"><br>S-02 Sign in or create account | <img src="screens/shared/S-03-verify-code-and-recover-access.svg" width="240" alt="S-03 Verify code and recover access"><br>S-03 Verify code and recover access |
| <img src="screens/shared/S-03-verify-code-and-recover-access--locked-out.svg" width="240" alt="S-03 Verify code and recover access — locked out"><br>S-03 Verify code and recover access — locked out | <img src="screens/shared/S-03-verify-code-and-recover-access--wrong-code.svg" width="240" alt="S-03 Verify code and recover access — wrong code"><br>S-03 Verify code and recover access — wrong code | <img src="screens/shared/S-04-initial-setup.svg" width="240" alt="S-04 Initial setup"><br>S-04 Initial setup |
| <img src="screens/shared/S-05-accept-an-invitation.svg" width="240" alt="S-05 Accept an invitation"><br>S-05 Accept an invitation | <img src="screens/shared/S-05-accept-an-invitation--expired.svg" width="240" alt="S-05 Accept an invitation — expired"><br>S-05 Accept an invitation — expired | <img src="screens/shared/S-06-account-and-preferences.svg" width="240" alt="S-06 Account and preferences"><br>S-06 Account and preferences |
| <img src="screens/shared/S-07-switch-role-or-business.svg" width="240" alt="S-07 Switch role or business [Sheet]"><br>S-07 Switch role or business [Sheet] | <img src="screens/shared/S-08-messages.svg" width="240" alt="S-08 Messages"><br>S-08 Messages | <img src="screens/shared/S-09-notifications.svg" width="240" alt="S-09 Notifications"><br>S-09 Notifications |
| <img src="screens/shared/S-09-notifications--replacement-offer.svg" width="240" alt="S-09 Notifications — replacement offer"><br>S-09 Notifications — replacement offer | <img src="screens/shared/S-10-job-chat.svg" width="240" alt="S-10 Job chat"><br>S-10 Job chat | <img src="screens/shared/S-10-job-chat--translation-unavailable.svg" width="240" alt="S-10 Job chat — translation unavailable"><br>S-10 Job chat — translation unavailable |
| <img src="screens/shared/S-11-safety-instruction.svg" width="240" alt="S-11 Safety instruction and acknowledgement"><br>S-11 Safety instruction and acknowledgement | <img src="screens/shared/S-11-safety-instruction--acknowledgement-pending.svg" width="240" alt="S-11 Safety instruction and acknowledgement — acknowledgement pending"><br>S-11 Safety instruction and acknowledgement — acknowledgement pending | <img src="screens/shared/S-12-language-and-display.svg" width="240" alt="S-12 Language and display"><br>S-12 Language and display |
| <img src="screens/shared/S-13-chat-details.svg" width="240" alt="S-13 Chat details [Sheet]"><br>S-13 Chat details [Sheet] | <img src="screens/shared/S-14-attach-a-photo-or-record-audio.svg" width="240" alt="S-14 Attach a photo or record audio [Sheet]"><br>S-14 Attach a photo or record audio [Sheet] | <img src="screens/shared/S-14-attach-a-photo-or-record-audio--recording.svg" width="240" alt="S-14 Attach a photo or record audio [Sheet] — recording"><br>S-14 Attach a photo or record audio [Sheet] — recording |
| <img src="screens/shared/S-15-media-and-original-audio-preview.svg" width="240" alt="S-15 Media and original audio preview [Modal]"><br>S-15 Media and original audio preview [Modal] | <img src="screens/shared/S-15-media-and-original-audio-preview--transcript-unavailable.svg" width="240" alt="S-15 Media and original audio preview [Modal] — transcript unavailable"><br>S-15 Media and original audio preview [Modal] — transcript unavailable | <img src="screens/shared/S-16-help-and-access-status.svg" width="240" alt="S-16 Help and access status"><br>S-16 Help and access status |
| <img src="screens/shared/S-17-confirm-consequential-action.svg" width="240" alt="S-17 Confirm consequential action [Modal]"><br>S-17 Confirm consequential action [Modal] |  |  |
| <img src="screens/shared/S-18-live-activity.svg" width="240" alt="S-18 generic visit on Lock Screen"><br>S-18 Lock Screen | <img src="screens/shared/S-18-live-activity--compact.svg" width="240" alt="Compact Island"><br>S-18 compact | <img src="screens/shared/S-18-live-activity--minimal.svg" width="240" alt="Minimal Island"><br>S-18 minimal |
| <img src="screens/shared/S-18-live-activity--expanded.svg" width="240" alt="Expanded Island"><br>S-18 expanded | | |

### Provider admin (P-)

Specs: [P-01–P-05 specs](screens/shared/P-01_P-05-specs.md)

| | | |
| --- | --- | --- |
| <img src="screens/shared/P-01-business-overview.svg" width="240" alt="P-01 Business overview"><br>P-01 Business overview | <img src="screens/shared/P-02-jobs-and-handoffs.svg" width="240" alt="P-02 Jobs and handoffs"><br>P-02 Jobs and handoffs | <img src="screens/shared/P-02-jobs-and-handoffs--handoff-stuck.svg" width="240" alt="P-02 Jobs and handoffs — handoff stuck"><br>P-02 Jobs and handoffs — handoff stuck |
| <img src="screens/shared/P-03-people-and-access.svg" width="240" alt="P-03 People and access"><br>P-03 People and access | <img src="screens/shared/P-03-people-and-access--access-revoked.svg" width="240" alt="P-03 People and access — access revoked"><br>P-03 People and access — access revoked | <img src="screens/shared/P-04-business-and-eligibility.svg" width="240" alt="P-04 Business and eligibility"><br>P-04 Business and eligibility |
| <img src="screens/shared/P-04-business-and-eligibility--eligibility-expiring.svg" width="240" alt="P-04 Business and eligibility — eligibility expiring"><br>P-04 Business and eligibility — eligibility expiring | <img src="screens/shared/P-05-invite-or-edit-membership.svg" width="240" alt="P-05 Invite or edit membership [Sheet]"><br>P-05 Invite or edit membership [Sheet] | <img src="screens/shared/P-05-invite-or-edit-membership--invite-pending.svg" width="240" alt="P-05 Invite or edit membership [Sheet] — invite pending"><br>P-05 Invite or edit membership [Sheet] — invite pending |

### Later categories (L-)

Specs: [L-01–L-06 specs](screens/shared/L-01_L-06-specs.md)

| | | |
| --- | --- | --- |
| <img src="screens/shared/L-01-browse-sessions.svg" width="240" alt="L-01 Browse sessions"><br>L-01 Browse sessions | <img src="screens/shared/L-02-session-detail.svg" width="240" alt="L-02 Session detail"><br>L-02 Session detail | <img src="screens/shared/L-02-session-detail--fully-booked.svg" width="240" alt="L-02 Session detail — fully booked"><br>L-02 Session detail — fully booked |
| <img src="screens/shared/L-03-choose-a-slot.svg" width="240" alt="L-03 Choose a slot [Sheet]"><br>L-03 Choose a slot [Sheet] | <img src="screens/shared/L-03-choose-a-slot--slot-just-taken.svg" width="240" alt="L-03 Choose a slot [Sheet] — slot just taken"><br>L-03 Choose a slot [Sheet] — slot just taken | <img src="screens/shared/L-04-review-and-book.svg" width="240" alt="L-04 Review and book"><br>L-04 Review and book |
| <img src="screens/shared/L-05-session-booking.svg" width="240" alt="L-05 Session booking"><br>L-05 Session booking | <img src="screens/shared/L-05-session-booking--pending-change.svg" width="240" alt="L-05 Session booking — pending change"><br>L-05 Session booking — pending change | <img src="screens/shared/L-05-session-booking--substitute-instructor-assigned.svg" width="240" alt="L-05 Session booking — substitute instructor assigned"><br>L-05 Session booking — substitute instructor assigned |
| <img src="screens/shared/L-06-session-setup-and-roster.svg" width="240" alt="L-06 Session setup and roster"><br>L-06 Session setup and roster | <img src="screens/shared/L-06-session-setup-and-roster--cover-unavailable.svg" width="240" alt="L-06 Session setup and roster — cover unavailable"><br>L-06 Session setup and roster — cover unavailable |  |

## Decisions and reviews

- [Decided operating model, pricing and launch languages](../docs/decisions/2026-11-23-open-questions.md)
- [Live Activity and attendance constraints](../research/tech-stack/live-activities-and-geofenced-attendance.md)
- [Architecture: mobile tech stack](../docs/architecture/mobile-tech-stack.md)
- [Flow design review and consolidated open questions](../docs/reports/2026-11-23-design-review-flows.md)
- [Visual design review](../docs/reports/2026-11-23-design-review-visual.md)
- [Tech stack research](../research/tech-stack/)

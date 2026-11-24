import { ids, sql } from "./cast";

export const checkpoints = ["request-sent", "assessment-done", "quote-issued", "quote-approved", "visit-booked", "crew-confirmed", "dropout", "cover-offered", "cover-accepted", "cover-confirmed", "on-the-way", "checked-in", "briefed", "work-started", "work-finished", "checked-out", "completion-submitted", "signed-off", "bill-issued", "paid-recorded"] as const;
export type Checkpoint = typeof checkpoints[number];
const timestamp = (value: string) => Date.parse(`2026-11-${value}+01:00`);
const mon = (time: string) => timestamp(`23T${time}:00`);
const tue = (time: string) => timestamp(`24T${time}:00`);
const q = sql;

export function constructionSql(until: Checkpoint): string {
  // This checkpoint illustrates the independent sign-off path with no bill reference.
  const billDraft = until === "signed-off" ? "NULL,NULL" : "'RR-0412',24000";
  const parts: string[][] = [
    [`INSERT INTO jobs (id,reference,business_id,place_id,requester_id,accountable_foreman_membership_id,trade,origin,state) VALUES (${q(ids.job)},'BB-1042',${q(ids.business)},${q(ids.villa)},${q(ids.claire)},${q(`${ids.mateo}-member`)},'carpentry','bookbuddy','open');`,
      `INSERT INTO requests (job_id,original_text,original_language,arrival_arrangement,submitted_at) VALUES (${q(ids.job)},'The terrace door needs repair.','en','requester',${mon("08:05")});`,
      `INSERT INTO jobs (id,reference,business_id,place_id,requester_id,trade,origin,state) VALUES (${q(ids.otherJob)},'BB-1031',${q(ids.business)},${q(ids.casa)},${q(ids.claire)},'carpentry','bookbuddy','open');`,
      `INSERT INTO requests (job_id,original_text,original_language,arrival_arrangement,submitted_at) VALUES (${q(ids.otherJob)},'Please inspect the door.','en','requester',${mon("08:00")});`,
      `INSERT INTO job_handoffs (id,job_id,business_id,recipient_id,issuer_id,policy,offered_at,expires_at,state) VALUES ('seed-handoff-1031',${q(ids.otherJob)},${q(ids.business)},${q(`${ids.ines}-member`)},${q(ids.mateo)},'standard',${mon("08:00")},${mon("10:00")},'offered');`],
    [`INSERT INTO visits (id,job_id,kind,state) VALUES ('seed-assessment-1042',${q(ids.job)},'assessment','finished');`,
      `INSERT INTO visit_windows (id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,confirmed_at,confirmed_by,state) VALUES ('seed-assessment-window-1042','seed-assessment-1042',${mon("08:09")},${mon("08:14")},${mon("08:09")},1,${mon("08:06")},${q(ids.mateo)},${mon("08:07")},${q(ids.claire)},'confirmed');`],
    [`INSERT INTO quotes (id,job_id) VALUES (${q(ids.quote)},${q(ids.job)});`,
      `INSERT INTO quote_versions (id,quote_id,job_id,business_id,no,author_id,terms_id,original_locale,scope,exclusions,net_minor,tax_minor,total_minor,currency,state) VALUES (${q(ids.version)},${q(ids.quote)},${q(ids.job)},${q(ids.business)},1,${q(ids.mateo)},${q(ids.terms)},'es','Ajustar la puerta de la terraza y sustituir los rodillos.','No incluye la sustitución del vidrio.',24000,0,24000,'EUR','draft');`,
      `INSERT INTO quote_items (version_id,line_no,original_label,quantity,net_minor,tax_minor,evidence_rule) VALUES (${q(ids.version)},1,'Mano de obra',1,16000,0,'Fotografía final'),(${q(ids.version)},2,'Rodillos',1,8000,0,'Fotografía final');`,
      `UPDATE quote_versions SET publisher_id=${q(ids.ines)},issued_at=${mon("08:15")},expires_at=${Date.parse("2026-11-30T07:15:00Z")},state='issued' WHERE id=${q(ids.version)};`],
    [`INSERT INTO approvals (id,quote_version_id,account_id,grant_id,terms_hash,decision,at) VALUES ('seed-approval-1042',${q(ids.version)},${q(ids.claire)},${q(`${ids.villa}-approve`)},'seed-terms-v1-hash','approve',${mon("08:20")});`,
      `UPDATE quote_versions SET state='approved' WHERE id=${q(ids.version)};`],
    [`INSERT INTO visits (id,job_id,kind,state) VALUES (${q(ids.visit)},${q(ids.job)},'work','booked');`,
      `INSERT INTO visit_windows (id,visit_id,starts_at,ends_at,expires_at,provider_authorized,proposed_at,proposed_by,confirmed_at,confirmed_by,state) VALUES (${q(ids.window)},${q(ids.visit)},${tue("09:00")},${tue("10:00")},${tue("08:00")},1,${mon("08:30")},${q(ids.mateo)},${mon("08:36")},${q(ids.claire)},'confirmed');`,
      `INSERT INTO shifts (id,visit_id,starts_at,ends_at,skill,briefing_language,state) VALUES (${q(ids.shift)},${q(ids.visit)},${tue("09:00")},${tue("10:00")},'carpentry','es','planned');`,
      `INSERT INTO shift_slots (id,shift_id,number,is_lead) VALUES (${q(ids.slot)},${q(ids.shift)},1,1);`],
    [`INSERT INTO assignments (id,slot_id,worker_membership_id,source,state,confirmed_by,confirmed_at,starts_at,ends_at) VALUES ('seed-assignment-nadia',${q(ids.slot)},${q(`${ids.nadia}-member`)},'ordinary','confirmed',${q(ids.nadia)},${mon("08:38")},${tue("09:00")},${tue("10:00")});`,
      `INSERT INTO customer_updates (id,visit_id,actor_id,kind,recorded_at) VALUES ('seed-crew-confirmed',${q(ids.visit)},${q(ids.mateo)},'crew_confirmed',${mon("08:38")});`],
    [`UPDATE assignments SET state='dropped',dropped_at=${tue("08:32")},dropout_reported_by=${q(ids.nadia)},dropout_source='self',dropout_reason='personal' WHERE id='seed-assignment-nadia';`,
      `INSERT INTO cover_gaps (id,slot_id,prior_assignment_id,safe_cutoff,state) VALUES ('seed-gap',${q(ids.slot)},'seed-assignment-nadia',${tue("08:42")},'open');`,
      `INSERT INTO customer_updates (id,visit_id,actor_id,kind,next_update_at,recorded_at) VALUES ('seed-cover-arranging',${q(ids.visit)},${q(ids.mateo)},'cover_arranging',${tue("08:45")},${tue("08:32")});`],
    [`INSERT INTO cover_dispatches (gap_id,dispatch_no,issued_by,issued_at,reply_until,state) VALUES ('seed-gap',1,${q(ids.mateo)},${tue("08:33")},${tue("08:42")},'open');`,
      `INSERT INTO cover_offers (id,gap_id,dispatch_no,recipient_id,expires_at,state) VALUES ('seed-offer-diego','seed-gap',1,${q(`${ids.diego}-member`)},${tue("08:42")},'offered'),('seed-offer-lucia','seed-gap',1,${q(`${ids.lucia}-member`)},${tue("08:42")},'offered');`,
      `INSERT INTO cover_rounds (gap_id,round_no,dispatch_no,state,opened_at) VALUES ('seed-gap',1,1,'open',${tue("08:33")});`,
      `UPDATE cover_gaps SET current_round_no=1 WHERE id='seed-gap';`],
    [`UPDATE cover_rounds SET state='accepted_pending_confirmation',winner_offer_id='seed-offer-diego',accepted_at=${tue("08:38")},confirm_by=${tue("08:42")} WHERE gap_id='seed-gap' AND round_no=1;`,
      `UPDATE cover_gaps SET state='accepted_pending_confirmation' WHERE id='seed-gap';`],
    [`INSERT INTO assignments (id,slot_id,worker_membership_id,cover_gap_id,source,state,confirmed_by,confirmed_at,starts_at,ends_at) VALUES ('seed-assignment-diego',${q(ids.slot)},${q(`${ids.diego}-member`)},'seed-gap','cover','confirmed',${q(ids.mateo)},${tue("08:40")},${tue("09:00")},${tue("10:00")});`,
      `UPDATE cover_rounds SET state='confirmed',ended_at=${tue("08:40")} WHERE gap_id='seed-gap' AND round_no=1;`,
      `UPDATE cover_gaps SET state='filled' WHERE id='seed-gap';`,
      `UPDATE cover_dispatches SET state='closed',closed_at=${tue("08:40")} WHERE gap_id='seed-gap' AND dispatch_no=1;`,
      `INSERT INTO safety_holds (id,assignment_id,kind,state) VALUES ('seed-cover-briefing-hold','seed-assignment-diego','briefing','active');`,
      `INSERT INTO customer_updates (id,visit_id,actor_id,kind,recorded_at) VALUES ('seed-crew-updated',${q(ids.visit)},${q(ids.mateo)},'crew_updated',${tue("08:40")});`],
    [`INSERT INTO customer_updates (id,visit_id,actor_id,kind,band_start,band_end,recorded_at) VALUES ('seed-on-way',${q(ids.visit)},${q(ids.mateo)},'on_the_way',${tue("09:10")},${tue("09:20")},${tue("08:52")});`],
    [`INSERT INTO attendance_events (id,assignment_id,actor_id,kind,source,actual_at,captured_at,received_at,review_state) VALUES ('seed-arrival','seed-assignment-diego',${q(ids.diego)},'arrival','self',${tue("09:14")},${tue("09:14")},${tue("09:14")},'accepted');`,
      `INSERT INTO customer_updates (id,visit_id,kind,occurred_at,recorded_at) VALUES ('seed-on-site',${q(ids.visit)},'on_site',${tue("09:14")},${tue("09:14")});`],
    [`INSERT INTO safety_instructions (id,job_id,assignment_id) VALUES ('seed-safety',${q(ids.job)},'seed-assignment-diego');`,
      `INSERT INTO safety_versions (id,instruction_id,no,issuer_id,original,language,issued_at) VALUES ('seed-safety-v2','seed-safety',2,${q(ids.mateo)},'No use la puerta de la terraza hasta que Mateo la autorice.','es',${tue("09:16")});`,
      `INSERT INTO safety_holds (id,assignment_id,version_id,kind,state) VALUES ('seed-safety-v2-hold','seed-assignment-diego','seed-safety-v2','briefing','active');`,
      `INSERT INTO teach_backs (id,version_id,assignment_id,verified_by,language,checklist,outcome,at) VALUES ('seed-teach-back','seed-safety-v2','seed-assignment-diego',${q(ids.mateo)},'es','{"hazard":true,"control":true,"response":true}','passed',${tue("09:16")});`,
      `INSERT INTO safety_acknowledgements (version_id,assignment_id,worker_id,teach_back_id,at) VALUES ('seed-safety-v2','seed-assignment-diego',${q(ids.diego)},'seed-teach-back',${tue("09:17")});`,
      `UPDATE safety_holds SET state='cleared',cleared_at=${tue("09:17")} WHERE id='seed-safety-v2-hold';`],
    [`INSERT INTO customer_updates (id,visit_id,actor_id,kind,recorded_at) VALUES ('seed-working',${q(ids.visit)},${q(ids.mateo)},'working',${tue("09:18")});`,
      `INSERT INTO visit_activity_events (id,visit_id,actor_id,kind,at,customer_update_id) VALUES ('seed-work-started',${q(ids.visit)},${q(ids.mateo)},'work_started',${tue("09:18")},'seed-working');`],
    [`INSERT INTO customer_updates (id,visit_id,actor_id,kind,recorded_at) VALUES ('seed-finished',${q(ids.visit)},${q(ids.mateo)},'finished',${tue("10:12")});`,
      `INSERT INTO visit_activity_events (id,visit_id,actor_id,kind,at,customer_update_id) VALUES ('seed-work-finished',${q(ids.visit)},${q(ids.mateo)},'work_finished',${tue("10:12")},'seed-finished');`],
    [`INSERT INTO attendance_events (id,assignment_id,actor_id,kind,source,actual_at,captured_at,received_at,review_state) VALUES ('seed-departure','seed-assignment-diego',${q(ids.diego)},'departure','self',${tue("10:14")},${tue("10:14")},${tue("10:14")},'accepted');`],
    [`INSERT INTO completions (id,job_id,base_quote_version_id,no,submitter_id,finished_at,submitted_at,bill_reference_hint,bill_amount_minor,state) VALUES ('seed-completion',${q(ids.job)},${q(ids.version)},1,${q(ids.mateo)},${tue("10:12")},${tue("10:15")},${billDraft},'submitted');`,
      `INSERT INTO completion_items (id,completion_id,quote_version_id,line_no,outcome,original_language,result_note,evidence_alternative) VALUES ('seed-completion-labour','seed-completion',${q(ids.version)},1,'done','es','Ajuste terminado','Inspección presencial'),('seed-completion-rollers','seed-completion',${q(ids.version)},2,'done','es','Rodillos sustituidos','Inspección presencial');`],
    [`INSERT INTO sign_offs (id,job_id,completion_id,approver_id,grant_id,terms_hash,at) VALUES ('seed-signoff',${q(ids.job)},'seed-completion',${q(ids.claire)},${q(`${ids.villa}-sign_off`)},'seed-terms-v1-hash',${tue("10:40")});`],
    [`INSERT INTO bills (id,job_id,business_id,number,version,net_minor,tax_minor,total_minor,currency,line_items,issued_at,due_at,state)
      VALUES ('seed-bill',${q(ids.job)},${q(ids.business)},'RR-0412',1,24000,0,24000,'EUR',
        '[{"originalLabel":"Mano de obra","originalLanguage":"es","netMinor":16000,"taxMinor":0},{"originalLabel":"Rodillos","originalLanguage":"es","netMinor":8000,"taxMinor":0}]',
        ${tue("10:40")},${Date.parse("2026-12-01T09:40:00Z")},'issued');`],
    [`INSERT INTO paid_records (id,bill_id,actor_id,kind,amount_minor,verified_reference,at) VALUES ('seed-paid','seed-bill',${q(ids.mateo)},'matched',24000,'demo-receipt',${timestamp("25T09:05:00")});`],
  ];
  return parts.slice(0, checkpoints.indexOf(until) + 1).flat().join("\n");
}

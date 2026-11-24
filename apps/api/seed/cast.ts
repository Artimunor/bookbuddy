import { loadOtpKey, mailboxKey } from "../src/modules/auth/crypto";

export const ids = {
  business: "seed-ruiz", area: "seed-area", villa: "seed-villa-mar", casa: "seed-casa-llum",
  claire: "seed-claire", mateo: "seed-mateo", nadia: "seed-nadia", diego: "seed-diego",
  lucia: "seed-lucia", sam: "seed-sam", ines: "seed-ines", pau: "seed-pau",
  steward: "seed-case-steward",
  job: "seed-bb-1042", otherJob: "seed-bb-1031", terms: "seed-terms-v1",
  quote: "seed-quote-1042", version: "seed-quote-1042-v1", visit: "seed-visit-1042",
  window: "seed-window-1042", shift: "seed-shift-1042", slot: "seed-slot-1042",
} as const;

export const sql = (value: string | number | null) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const insert = (table: string, columns: string, values: (string | number | null)[]) =>
  `INSERT INTO ${table} (${columns}) VALUES (${values.map(sql).join(", ")});`;

const cast = [
  ["claire", "Claire Martin", "customer", "en"], ["mateo", "Mateo Ruiz", "foreman, provider admin", "en"],
  ["nadia", "Nadia Benali", "worker", "en"], ["diego", "Diego Torres", "worker", "pt-PT"],
  ["lucia", "Lucía Ortega", "worker", "en"], ["sam", "Sam Martin", "customer, view only", "en"],
  ["ines", "Inés Vidal", "foreman, reviewer", "en"], ["pau", "Pau Soler", "worker, review pending", "en"],
  ["steward", "BookBuddy Local Service", "BookBuddy case steward", "en"],
] as const;

export async function castSql(domain: string, secret: string) {
  const key = await loadOtpKey(secret);
  if (!key) throw new Error("OTP_HMAC_KEY in apps/api/.dev.vars must contain at least 32 characters");
  const rows: string[] = [];
  const accounts = await Promise.all(cast.map(async ([name, display, roles, locale]) => {
    const email = `${name}@${domain}`;
    const digest = await mailboxKey(key, email);
    return { name, display, roles, locale, email, digest, id: ids[name] };
  }));
  for (const account of accounts) {
    rows.push(insert("accounts", "id,email_normalized,email_key,display_name,verified_at,setup_at,state", [account.id, account.email, account.digest, account.display, 1, 1, "active"]));
    rows.push(insert("account_preferences", "account_id,ui_locale,reading_locale,two_clock", [account.id, account.locale, account.locale, account.name === "claire" ? 1 : 0]));
  }
  rows.push(insert("operating_areas", "id,name,site_zone,polygon", [ids.area, "Demo area", "Europe/Madrid", JSON.stringify([[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]])]));
  for (let day = 1; day <= 5; day++) rows.push(insert("staffed_calendar", "id,area_id,weekday,opens_minute,closes_minute", [`seed-calendar-${day}`, ids.area, day, 480, 1080]));
  rows.push(insert("businesses", "id,legal_name,public_name,verified_work_contact,catchment_id,state", [ids.business, "Reformas Ruiz", "Reformas Ruiz", accounts[1]!.email, ids.area, "approved"]));
  for (const name of ["mateo", "nadia", "diego", "lucia", "ines", "pau"] as const) {
    const id = ids[name], membership = `${id}-member`;
    rows.push(insert("memberships", "id,business_id,account_id,state", [membership, ids.business, id, "active"]));
    const roles = name === "mateo" ? ["foreman", "provider_admin"] : name === "ines" ? ["foreman"] : ["worker"];
    for (const role of roles) {
      const grant = `${id}-${role}-role`;
      rows.push(insert("membership_roles", "id,membership_id,business_id,account_id,role,granted_at", [grant, membership, ids.business, id, role, 1]));
      rows.push(insert("account_contexts", "id,account_id,role,business_id,role_grant_id", [`${id}-${role}-context`, id, role, ids.business, grant]));
    }
    rows.push(insert("member_skills", "membership_id,tag", [membership, "carpentry"]));
    rows.push(insert("member_languages", "membership_id,tag", [membership, "es"]));
    if (name === "diego") rows.push(insert("member_languages", "membership_id,tag", [membership, "pt-PT"]));
    rows.push(insert("eligibility_checks", "id,business_id,membership_id,trade,work_language,scope,state,checked_by,checked_at,valid_until", [`${id}-eligibility`, ids.business, membership, "carpentry", "es", "internal", name === "pau" ? "pending" : "approved", name === "pau" ? null : ids.mateo, name === "pau" ? null : 1, name === "pau" ? null : 4102444800000]));
  }
  for (const name of ["nadia", "diego", "lucia"] as const) {
    rows.push(insert("availability_intervals", "id,membership_id,week_day_or_date,starts_at,ends_at,kind,source,open_to_cover,recorded_by,recorded_at",
      [`${ids[name]}-availability`, `${ids[name]}-member`, "2026-11-24", Date.parse("2026-11-24T07:00:00Z"), Date.parse("2026-11-24T17:00:00Z"), "available", "worker", 1, ids[name], 1]));
  }
  rows.push(`UPDATE businesses SET default_foreman_id = ${sql(`${ids.mateo}-member`)} WHERE id = ${sql(ids.business)};`);
  for (const capability of ["handoff", "backup_foreman", "review_commercial", "publish_commercial", "issue_bill", "record_paid", "membership_admin", "schedule_correction"]) {
    rows.push(insert("business_grants", "id,business_id,membership_id,capability,issuer_id,valid_from", [`seed-mateo-${capability}`, ids.business, `${ids.mateo}-member`, capability, ids.ines, 1]));
  }
  for (const capability of ["review_commercial", "publish_commercial", "backup_foreman"]) rows.push(insert("business_grants", "id,business_id,membership_id,capability,issuer_id,valid_from", [`seed-ines-${capability}`, ids.business, `${ids.ines}-member`, capability, ids.mateo, 1]));
  for (const name of ["claire", "sam", "steward"] as const) rows.push(insert("account_contexts", "id,account_id,role", [`${ids[name]}-customer-context`, ids[name], "customer"]));
  for (const [place, alias] of [[ids.villa, "Villa Mar"], [ids.casa, "Casa Llum"]] as const) {
    rows.push(insert("places", "id,owner_id,alias,normalized_address,state", [place, ids.claire, alias, `Fictional ${alias}`, "pending_verification"]));
    rows.push(insert("place_people", "place_id,account_id,verified_from,history_from", [place, ids.claire, 1, 1]));
    rows.push(`UPDATE places SET named_approver_id=${sql(ids.claire)}, pin='{"latitude":0,"longitude":0}', site_zone='Europe/Madrid', area_id=${sql(ids.area)}, state='in_area' WHERE id=${sql(place)};`);
    for (const capability of ["view", "message", "request", "book", "approve", "sign_off", "bill_view", "delegate"]) rows.push(insert("place_grants", "id,place_id,account_id,capability,issuer_id,valid_from", [`${place}-${capability}`, place, ids.claire, capability, ids.claire, 1]));
  }
  rows.push(insert("place_people", "place_id,account_id,verified_from,history_from", [ids.villa, ids.sam, 1, 1]));
  rows.push(insert("place_grants", "id,place_id,account_id,capability,issuer_id,valid_from", ["seed-sam-view", ids.villa, ids.sam, "view", ids.claire, 1]));
  rows.push(insert("terms_versions", "id,business_id,version,provider_legal_snapshot,original_text,contract_locale,consent_text,hash", [ids.terms, ids.business, 1, "Reformas Ruiz", "Condiciones de demostración.", "es", "Acepto las condiciones de demostración.", "seed-terms-v1-hash"]));
  return { sql: rows.join("\n"), accounts };
}

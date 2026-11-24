import { at } from "../access/policy";
import { models } from "./policy";
import type { CommercialKind } from "./policy";

// The review is recorded on an immutable artifact, not inferred from the
// reviewer's current role. Keep its recorded context in the version's business.
export function reviewedArtifact(kind: CommercialKind, version: string): string {
  return `FROM reading_artifacts artifact JOIN account_contexts reviewer ON reviewer.id = artifact.reviewed_by_context_id
    WHERE artifact.${models[kind].ref} = ${version}.id AND reviewer.business_id = ${version}.business_id
      AND reviewer.role IN ('foreman', 'provider_admin') AND artifact.reviewed_at <= ${at}`;
}

export function readingAid(kind: CommercialKind, version: string): string {
  // 0010 stores one reviewed passage. Never present the original timing,
  // exclusions, line labels or legal terms as translations of that passage.
  const passage = kind === "quote" ? "'scope', artifact.translated_text, 'exclusions', ''"
    : "'text', artifact.translated_text, 'timing', NULL, 'affectedItems', NULL";
  return `json(coalesce((SELECT json_object('status', 'ready', 'ref', artifact.id, 'locale', artifact.target_locale,
      ${passage}, 'items', json_array(), 'termsText', NULL) ${reviewedArtifact(kind, version)}
    AND artifact.target_locale = (SELECT reading_locale FROM account_preferences WHERE account_id = scope.account_id) COLLATE NOCASE
    AND artifact.target_locale <> ${version}.original_locale COLLATE NOCASE
    ORDER BY artifact.reviewed_at DESC, artifact.id DESC LIMIT 1), json_object('status', 'original_only')))`;
}

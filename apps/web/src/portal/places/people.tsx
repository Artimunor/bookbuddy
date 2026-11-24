import type { PlaceDetails, PlacePersonPatch } from "@bookbuddy/api-contract";
import { useState } from "react";
import { Button, Dialog, Select, SwitchRow } from "../../ui";
import { usePortal } from "../now/common";

type Person = PlaceDetails["people"][number];

export function PlacePersonDialog({ person, place, busy, close, save }: {
  person: Person;
  place: PlaceDetails;
  busy: boolean;
  close: () => void;
  save: (patch: PlacePersonPatch) => void;
}) {
  const { t } = usePortal();
  const canView = person.isOwner || person.capabilities.includes("view");
  const canMessage = person.capabilities.includes("message");
  const [view, setView] = useState(canView);
  const [message, setMessage] = useState(canMessage);
  const [approve, setApprove] = useState(person.isNamedApprover);
  const [successor, setSuccessor] = useState("");
  const needsSuccessor = person.isNamedApprover && !approve;
  const replacements = needsSuccessor ? place.people.filter(other => other.accountId !== person.accountId && other.capabilities.includes("view")) : [];
  const nextApprover = approve && !person.isNamedApprover ? person : replacements.find(other => other.accountId === successor);
  const patch: PlacePersonPatch = {
    ...(view !== canView ? { view } : {}),
    ...(message !== canMessage ? { message } : {}),
    ...(approve !== person.isNamedApprover ? { approve } : {}),
    ...(needsSuccessor && nextApprover ? { successorAccountId: nextApprover.accountId } : {}),
  };
  const disabled = busy || !Object.keys(patch).length || needsSuccessor && !nextApprover;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}
    title={t("web.portal.ps.editPerson")} description={t("web.portal.ps.personEffect", { name: person.displayName })}
    closeLabel={t("web.portal.work.close")}
    footer={<Button disabled={disabled} onClick={() => save(patch)}>{t("web.portal.ps.confirmPermissions")}</Button>}>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="text-label">{t("web.portal.ps.personPermissions")}</legend>
      <SwitchRow label={t("web.portal.ps.personView")} checked={view} disabled={person.isOwner || message || approve} onCheckedChange={setView} />
      <SwitchRow label={t("web.portal.ps.personMessage")} checked={message} disabled={!view} onCheckedChange={setMessage} />
      <SwitchRow label={t("web.portal.ps.personApprove")} checked={approve} disabled={!place.actions.changeApprover || !view || !canView} onCheckedChange={setApprove} />
      {needsSuccessor && <Select label={t("web.portal.ps.changeApprover")} value={successor} onChange={event => setSuccessor(event.target.value)}>
        <option value="">{t("web.portal.ps.choosePerson")}</option>
        {replacements.map(other => <option key={other.accountId} value={other.accountId}>{other.displayName}</option>)}
      </Select>}
    </fieldset>
    {(needsSuccessor || (approve && !person.isNamedApprover)) && <p>{t("web.portal.ps.verifiedApprover")}</p>}
    {nextApprover && <p>{t("web.portal.ps.approverEffect", { name: nextApprover.displayName })}</p>}
  </Dialog>;
}

import { useState, type ComponentProps } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { HelpView } from "./Screen";

function Fixture({ reason, initialForm = false, state = "editing" }: {
  reason: ComponentProps<typeof HelpView>["reason"]; initialForm?: boolean; state?: ComponentProps<typeof HelpView>["state"];
}) {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  return <HelpView reason={reason} reference={reason === "generic" ? undefined : "HX-2Q7"} lastConfirmed="16 Nov 2026" signedIn accountAttached providerAdmin form={form}
    message={message} email={email} state={state} receipt={state === "sent" ? "HX-3R8" : undefined} onMessage={setMessage} onEmail={setEmail}
    onContact={() => setForm(true)} onSend={() => {}} onBack={() => {}} onEligibility={() => {}} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-16", state: "generic", render: () => <Fixture reason="generic" /> },
  { id: "S-16", state: "expired", render: () => <Fixture reason="expired" /> },
  { id: "S-16", state: "removed", render: () => <Fixture reason="removed" /> },
  { id: "S-16", state: "pending-eligibility", render: () => <Fixture reason="pending" /> },
  { id: "S-16", state: "contact", render: () => <Fixture reason="expired" initialForm /> },
  { id: "S-16", state: "uncertain", render: () => <Fixture reason="expired" initialForm state="uncertain" /> },
  { id: "S-16", state: "sent", render: () => <Fixture reason="expired" initialForm state="sent" /> },
];

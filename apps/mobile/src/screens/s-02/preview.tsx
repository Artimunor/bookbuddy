import { useState, type ComponentProps } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { SignInView } from "./Screen";

const sampleEmail = "claire@example.com";
function Fixture({ state, initialEmail = sampleEmail, retryAt }: {
  state: ComponentProps<typeof SignInView>["state"]; initialEmail?: string; retryAt?: number;
}) {
  const [email, setEmail] = useState(initialEmail);
  return <SignInView state={state} email={email} onChangeEmail={setEmail} retryAt={retryAt}
    onSend={() => {}} onBack={() => {}} onHelp={() => {}} readOnly={state === "uncertain"} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-02", state: "new", render: () => <Fixture state="new" /> },
  { id: "S-02", state: "invalid", render: () => <Fixture state="invalid" initialEmail="claire@" /> },
  { id: "S-02", state: "rate-limited", render: () => <Fixture state="rate-limited" retryAt={new Date(2026, 10, 24, 9, 46).getTime()} /> },
  { id: "S-02", state: "offline", render: () => <Fixture state="offline" /> },
  { id: "S-02", state: "uncertain", render: () => <Fixture state="uncertain" /> },
];

import { useState, type ComponentProps } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { VerifyView } from "./Screen";

type Props = ComponentProps<typeof VerifyView>;
function Fixture({ initialCode = "", ...props }: Pick<Props, "variant" | "resendSeconds" | "retryAt" | "lockMinutes" | "triesLeft" | "offline" | "issue"> & { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  return <VerifyView {...props} email="claire@example.com" code={code} onCode={setCode}
    onVerify={() => {}} onResend={() => {}} onCheck={() => {}} onBack={() => {}} onHelp={() => {}} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-03", state: "waiting", render: () => <Fixture variant="waiting" initialCode="42" resendSeconds={47} /> },
  { id: "S-03", state: "wrong-code", render: () => <Fixture variant="wrong" triesLeft={2} /> },
  { id: "S-03", state: "locked-out", render: () => <Fixture variant="locked" retryAt={new Date(2026, 10, 24, 9, 56).getTime()} lockMinutes={15} /> },
  { id: "S-03", state: "expired", render: () => <Fixture variant="expired" /> },
  { id: "S-03", state: "offline", render: () => <Fixture variant="waiting" offline /> },
  { id: "S-03", state: "verify-uncertain", render: () => <Fixture variant="waiting" initialCode="423680" issue="verify-uncertain" /> },
  { id: "S-03", state: "resend-uncertain", render: () => <Fixture variant="waiting" issue="resend-uncertain" /> },
];

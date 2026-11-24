import { useState, type ComponentProps } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { SetupView } from "./Screen";

function Fixture({ status, busy, twoClock = true }: Pick<ComponentProps<typeof SetupView>, "status" | "busy"> & { twoClock?: boolean }) {
  const [draft, setDraft] = useState<ComponentProps<typeof SetupView>["draft"]>({ name: "Claire Martin", readingLocale: "en", twoClock, shareDisplayZone: false });
  return <SetupView status={status} busy={busy} draft={draft} email="claire@example.com"
    viewerZone="Europe/London" onChange={setDraft} onSave={() => {}} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-04", state: "defaults", render: () => <Fixture /> },
  { id: "S-04", state: "site-time-only", render: () => <Fixture twoClock={false} /> },
  { id: "S-04", state: "saving", render: () => <Fixture busy /> },
  { id: "S-04", state: "save-failed", render: () => <Fixture status="failed" /> },
  { id: "S-04", state: "offline", render: () => <Fixture status="offline" /> },
  { id: "S-04", state: "save-uncertain", render: () => <Fixture status="checking" /> },
];

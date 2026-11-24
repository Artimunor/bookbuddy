import type { ScreenPreview } from "../../preview/screens/types";
import { fixturePhoto, fixtureVoice } from "./attachment-fixtures";
import { emptyDraft } from "./draft";
import { DescribeView } from "./Screen";
const noop = () => {};
const props = { onChange: noop, onBack: noop, onContinue: noop, onAdd: noop, failed: false };
const sample = { ...emptyDraft, description: "The terrace door sticks when I close it and no longer slides smoothly. It has got worse over the last month.", language: "en" };
const attachmentActions = { onOpen: noop, onRemove: noop, onRetry: noop };
export const previews: ScreenPreview[] = [
  { id: "C-02", state: "empty", render: () => <DescribeView {...props} draft={emptyDraft} saved={false} offline={false} /> },
  { id: "C-02", state: "saved-offline", render: () => <DescribeView {...props} draft={{ ...emptyDraft, description: "The terrace door sticks when I close it.", language: "en" }} saved offline /> },
  { id: "C-02", state: "with-photos", render: () => <DescribeView {...props} {...attachmentActions} draft={sample} saved offline={false} items={[fixturePhoto]} /> },
  { id: "C-02", state: "voice-recorded", render: () => <DescribeView {...props} {...attachmentActions} draft={{ ...emptyDraft, language: "en" }} saved offline={false} items={[fixtureVoice]} /> },
  { id: "C-02", state: "photo-failed", render: () => <DescribeView {...props} {...attachmentActions} draft={sample} saved offline={false} items={[{ ...fixturePhoto, state: "failed" }]} /> },
];

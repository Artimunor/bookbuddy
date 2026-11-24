import type { ScreenPreview } from "../../preview/screens/types";
import { emptyDraft } from "./draft";
import { DescribeView } from "./Screen";
const noop = () => {};
const props = { onChange: noop, onBack: noop, onContinue: noop, failed: false };
export const previews: ScreenPreview[] = [
  { id: "C-02", state: "empty", render: () => <DescribeView {...props} draft={emptyDraft} saved={false} offline={false} /> },
  { id: "C-02", state: "saved-offline", render: () => <DescribeView {...props} draft={{ ...emptyDraft, description: "The terrace door sticks when I close it.", language: "en" }} saved offline /> },
];

import type { ScreenPreview } from "../../preview/screens/types";
import { quote } from "../c-06/preview";
import { QuoteView } from "../c-06/Screen";
import { ApprovalView } from "./Screen";
const empty = () => {};
const viewer = { ...quote, viewerIsNamedApprover: false, actions: { approve: false, decline: false } };
const replaced = { ...quote, state: "superseded" as const, actions: { approve: false, decline: false }, replacedBy: { id: quote.id, no: 2, issuedAt: quote.issuedAt } };
const approved = { ...quote, state: "approved" as const, actions: { approve: false, decline: false } };
export const previews: ScreenPreview[] = [
  { id: "C-07", state: "ready", render: () => <Preview data={quote} state="idle" /> },
  { id: "C-07", state: "not-the-named-approver", render: () => <Preview data={viewer} state="idle" /> },
  { id: "C-07", state: "changed", render: () => <Preview data={replaced} state="conflict" /> },
  { id: "C-07", state: "processing", render: () => <Preview data={quote} state="sending" /> },
  { id: "C-07", state: "checking", render: () => <Preview data={quote} state="checking" /> },
  { id: "C-07", state: "approved", render: () => <Preview data={approved} state="done" /> },
  { id: "C-07", state: "failed", render: () => <Preview data={quote} state="failed" /> },
];
function Preview({ data, state }: { data: typeof quote; state: "idle" | "sending" | "checking" | "conflict" | "done" | "failed" }) { return <><QuoteView data={data} status="ready" onBack={empty} onRetry={empty} onOpen={empty} onReview={empty} /><ApprovalView data={data} state={state} onClose={empty} onApprove={empty} onDecline={empty} onCurrent={empty} /></>; }

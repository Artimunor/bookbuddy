import { threadSummarySchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { MessagesView } from "./Screen";
import { details, translated } from "../s-10/preview";
const first = translated.entries[0]!;
const thread = threadSummarySchema.parse({ id: details.id, audience: details.audience, job: details.job, writeState: details.writeState, contact: { displayName: "Mateo Ruiz", role: "foreman", isViewer: false }, unreadCount: 1, latest: { author: first.author, sourceLanguage: first.sourceLanguage, originalText: first.originalText, preferredTranslation: first.preferredTranslation, receivedAt: first.receivedAt, attachmentKind: null } });
const noop = () => {};
export const previews: ScreenPreview[] = [
 { id: "S-08", state: "unread", render: () => <MessagesView status="ready" threads={[thread]} onOpen={noop} onRetry={noop} /> },
 { id: "S-08", state: "empty", render: () => <MessagesView status="ready" threads={[]} onOpen={noop} onRetry={noop} /> },
 { id: "S-08", state: "cached", render: () => <MessagesView status="offline" threads={[thread]} onOpen={noop} onRetry={noop} /> },
];

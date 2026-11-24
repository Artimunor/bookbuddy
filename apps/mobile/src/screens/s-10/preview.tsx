import { chatEntryProjectionSchema, threadDetailsSchema, threadEntriesPageSchema } from "@bookbuddy/api-contract";
import type { ScreenPreview } from "../../preview/screens/types";
import { ChatView } from "./Screen";
const now = Date.UTC(2026, 10, 24, 7, 52);
const job = { id: "job-1042", reference: "BB-1042", title: "Terrace door repair", siteZone: "Europe/Madrid" };
const mateo = { displayName: "Mateo Ruiz", role: "foreman", isViewer: false };
const claire = { displayName: "Claire Martin", role: "customer", isViewer: true };
export const details = threadDetailsSchema.parse({ id: "thread-1", audience: "job", job, writeState: "open", canSend: true, readOnlyReason: null, readPosition: 0, lastPosition: 2, readingLocale: "en", members: [{ ...mateo, isContact: true, writingLanguage: "es", readingLocale: "es" }, { ...claire, isContact: false, writingLanguage: "en", readingLocale: "en" }] });
const entry = chatEntryProjectionSchema.parse({ id: "entry-1", rootId: "message-1", revision: 1, position: 1, receivedAt: now - 300000, correctsId: null, author: mateo, sourceLanguage: "es", originalText: "Buenos días Claire. Llegaremos entre las nueve y diez y las nueve y veinte.", preferredTranslation: { state: "ready", targetLocale: "en", text: "Good morning Claire. We'll arrive between 9:10 and 9:20.", producedAt: now - 300000 }, attachments: [] });
const reply = chatEntryProjectionSchema.parse({ id: "entry-2", rootId: "message-2", revision: 1, position: 2, receivedAt: now - 60000, correctsId: null, author: claire, sourceLanguage: "en", originalText: "Thank you, Mateo. See you then.", preferredTranslation: null, attachments: [], readingLocales: ["es"] });
export const translated = threadEntriesPageSchema.parse({ threadId: "thread-1", audience: "job", entries: [entry, reply], stamps: [{ visitId: "visit-1", isCurrent: true, update: { id: "update-1", kind: "crew_updated", recordedAt: now - 720000, sharedByName: "Mateo Ruiz" } }, { visitId: "visit-1", isCurrent: true, update: { id: "update-2", kind: "on_the_way", recordedAt: now, sharedByName: "Mateo Ruiz", band: { startsAt: now + 18 * 60000, endsAt: now + 28 * 60000 } } }], page: { cursor: null, hasMore: false } });
const unavailable = threadEntriesPageSchema.parse({ ...translated, entries: [{ ...entry, preferredTranslation: { state: "unavailable", targetLocale: "en", canRetry: true } }, reply] });
const rtl = threadEntriesPageSchema.parse({ ...translated, entries: [{ ...entry, author: { displayName: "Nadia Benali", role: "worker", isViewer: false }, sourceLanguage: "ar", originalText: "صباح الخير، سأصل قريباً.", preferredTranslation: { state: "ready", targetLocale: "en", text: "Good morning, I'll be there soon.", producedAt: now } }, reply] });
const crewDetails = threadDetailsSchema.parse({ ...details, audience: "crew", members: [{ ...mateo, isContact: true, writingLanguage: "es", readingLocale: "es" }, { displayName: "Diego Torres", role: "worker", isViewer: true, isContact: false, writingLanguage: "en", readingLocale: "en" }] });
const crew = threadEntriesPageSchema.parse({ ...translated, audience: "crew", stamps: [{ id: "stamp-1", visitId: "visit-1", at: now, isCurrent: true, actorName: "Diego Torres", kind: "checked_in" }] });
const noop = () => {};
const props = { pending: [], offline: false, draft: "", busy: false, failed: false, reported: false, onDraft: noop, onSend: noop, onMore: noop, onBack: noop, onDetails: noop, onRetry: noop, onReport: noop, onTranslate: noop };
export const previews: ScreenPreview[] = [
 { id: "S-10", state: "translated", render: () => <ChatView {...props} data={details} page={translated} /> },
 { id: "S-10", state: "translation-unavailable", render: () => <ChatView {...props} data={details} page={unavailable} /> },
 { id: "S-10", state: "rtl-original", render: () => <ChatView {...props} data={details} page={rtl} /> },
 { id: "S-10", state: "crew-only", render: () => <ChatView {...props} data={crewDetails} page={crew} /> },
 { id: "S-10", state: "queued", render: () => <ChatView {...props} data={details} page={translated} offline pending={[{ id: "waiting", text: "See you then.", sourceLanguage: "en", at: now }]} /> },
 { id: "S-10", state: "read-only", render: () => <ChatView {...props} data={{ ...details, canSend: false, readOnlyReason: "job_closed", writeState: "read_only" }} page={translated} /> },
];

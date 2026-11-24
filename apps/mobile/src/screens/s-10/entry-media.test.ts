import { attachmentIdSchema, chatEntryIdSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { chatEntryMedia } from "./entry-media";

test("chat photos batch by the exact entry rather than its thread or message root", () => {
  const first = chatEntryIdSchema.parse("entry-first");
  const second = chatEntryIdSchema.parse("entry-second");
  const photo = attachmentIdSchema.parse("photo");
  const anotherPhoto = attachmentIdSchema.parse("another-photo");
  const unavailable = attachmentIdSchema.parse("unavailable-photo");
  const voice = attachmentIdSchema.parse("voice-note");
  const entries = [
    { id: first, attachments: [
      { attachmentId: photo, kind: "photo", availability: "available" },
      { attachmentId: anotherPhoto, kind: "photo", availability: "available" },
    ] },
    { id: second, attachments: [
      { attachmentId: unavailable, kind: "photo", availability: "unavailable" },
      { attachmentId: voice, kind: "voice", availability: "available" },
    ] },
  ] satisfies Parameters<typeof chatEntryMedia>[0][];
  expect(entries.map(chatEntryMedia)).toEqual([
    { scope: { caller: "chat", parentScopeId: first }, photoIds: [photo, anotherPhoto] },
    { scope: { caller: "chat", parentScopeId: second }, photoIds: [] },
  ]);
});

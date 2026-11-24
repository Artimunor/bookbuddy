import { attachmentIdSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { quoteEvidenceOpeners } from "./evidence";

test("voice and failed thumbnail grants both keep an opener scoped to the quote version", () => {
  const photo = attachmentIdSchema.parse("photo");
  const failedPhoto = attachmentIdSchema.parse("failed-photo");
  const voice = attachmentIdSchema.parse("voice-note");
  const links = [photo, failedPhoto, voice].map(attachmentId => ({ attachmentId }));
  const scope = { caller: "quote", parentScopeId: "quote-version" } as const;
  const url = "https://media.example.test/photo";
  const opened: { id: string; caller: string; parentScopeId: string }[] = [];
  const evidence = quoteEvidenceOpeners(links, new Map([[photo, url]]), scope, (id, parent) => { opened.push({ id, ...parent }); });
  expect(evidence.map(({ id, uri }) => ({ id, uri }))).toEqual([
    { id: photo, uri: url }, { id: failedPhoto, uri: undefined }, { id: voice, uri: undefined },
  ]);
  for (const item of evidence) item.open();
  expect(opened).toEqual([{ id: photo, ...scope }, { id: failedPhoto, ...scope }, { id: voice, ...scope }]);
});

import { expect, test } from "bun:test";
import { createCardStopJournal } from "./stop-journal";

test("the exact native stop remains on disk across a crash or a rejected stop", async () => {
  type Card = { id: string; scopeKey: string; stopPending?: true };
  const card: Card = { id: "native-card", scopeKey: "original-scope" };
  let encoded = JSON.stringify(card);
  const persist = async (next: Card | null) => { encoded = JSON.stringify(next); };
  const attempted: string[] = [];
  const first = createCardStopJournal(persist, async (id) => {
    attempted.push(id);
    throw new Error("Bridge unavailable");
  });
  await first.mark(card);
  expect(attempted).toEqual([]);
  const marked = JSON.parse(encoded) as Card;
  expect(marked).toEqual({ ...card, stopPending: true });
  await expect(first.finish(marked)).rejects.toThrow("Bridge unavailable");
  expect(JSON.parse(encoded)).toEqual(marked);

  const reopened = createCardStopJournal(persist, async (id) => {
    attempted.push(id);
    expect(JSON.parse(encoded)).toEqual(marked);
  });
  await reopened.finish(JSON.parse(encoded));
  expect(attempted).toEqual([card.id, card.id]);
  expect(JSON.parse(encoded)).toBeNull();
});

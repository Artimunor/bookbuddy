import { expect, test } from "bun:test";
import { handoffPresentation } from "./handoff";

const preview = {
  revision: 0,
  handoffPreview: { deadlines: { standard: null, urgent: 1_800_000 } },
  handoff: null,
};

test("a preview with only an urgent deadline enables only Urgent", () => {
  expect(handoffPresentation(preview, null, "job")).toEqual({
    awaitingDetail: false, standard: false, urgent: true, replyAt: null,
  });
});

test("the issued receipt, not the preview, determines the confirmed reply deadline", () => {
  const receipt = { jobId: "job", handoffId: "urgent", revision: 1, state: "offered" as const, expiresAt: 2_400_000, endedAt: null };
  for (const detail of [preview, null]) {
    expect(handoffPresentation(detail, receipt, "job")).toEqual({
      awaitingDetail: true, standard: false, urgent: false, replyAt: receipt.expiresAt,
    });
  }
  const refreshed = { revision: 1, handoffPreview: null, handoff: { handoffId: "urgent", expiresAt: 1_800_000 } };
  expect(handoffPresentation(refreshed, receipt, "job").replyAt).toBe(receipt.expiresAt);
  const newer = { ...refreshed, revision: 2, handoff: { handoffId: "newer", expiresAt: 3_000_000 } };
  expect(handoffPresentation(newer, receipt, "job").replyAt).toBe(newer.handoff.expiresAt);
  expect(handoffPresentation(null, receipt, "other").replyAt).toBeNull();
});

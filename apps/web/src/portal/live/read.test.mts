import { expect, spyOn, test } from "bun:test";
import { createLiveSubscription } from "@bookbuddy/api-client";
import { customerLiveVisitSchema } from "@bookbuddy/api-contract";
import { createPortalApi } from "../session/api";
import { createLiveVisitRead } from "./read";

const at = 1_800_000_000_000;
const visit = customerLiveVisitSchema.parse({
  visitId: "visit-afternoon", job: { id: "job-1", reference: "BB-1", title: "plumbing", placeAlias: "Villa" },
  window: { id: "window-1", startsAt: at, endsAt: at + 7_200_000 },
  siteZone: "Europe/Madrid", providerName: "Reform Archive", foremanName: null, jobThreadId: null, completionId: null,
  confirmedCrewNames: ["Private Crew Member"],
  live: { status: "confirmed", step: "confirmed", since: at, source: null, arrival: null, nextUpdateAt: null },
  moments: [{ id: "update-1", kind: "crew_confirmed", recordedAt: at, sharedByName: "Private Foreman" }],
  page: { hasMore: true, cursor: "older" },
});
const visitPath = "/api/v1/visits/visit-afternoon/live";
const meta = { serverTime: at, requestId: "live-read" };

function setup() {
  const urls: string[] = [];
  type Pending = { response: ReturnType<typeof Promise.withResolvers<Response>>; signal: AbortSignal | null | undefined };
  let next = Promise.withResolvers<Pending>();
  const api = createPortalApi({
    identity: { sessionId: "session-1", contextId: "context-1" },
    getLocale: () => "en", isCurrent: () => true, onSessionChanged: () => {},
    fetch: (url, { signal }) => {
      const response = Promise.withResolvers<Response>();
      urls.push(url);
      next.resolve({ response, signal });
      next = Promise.withResolvers<Pending>();
      return response.promise;
    },
  });
  const read = createLiveVisitRead(api, visit.job.id, visit.visitId);
  return { read, urls, nextRequest: () => next.promise };
}

function settled(read: ReturnType<typeof createLiveVisitRead>) {
  return new Promise<ReturnType<typeof read.snapshot>>((resolve) => {
    const unsubscribe = read.subscribe(() => {
      const state = read.snapshot();
      if (state.loading) return;
      unsubscribe();
      resolve(state);
    });
  });
}

test.each([403, 404])("foreground hides visit details until the exact visit is reauthorized (%s)", async (status) => {
  const { read, urls, nextRequest } = setup();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const initialRequest = nextRequest();
  const stop = read.watchVisibility(page);
  try {
    const opened = settled(read);
    (await initialRequest).response.resolve(Response.json({ ok: true, data: visit, meta }));
    expect((await opened).visit).toMatchObject({ confirmedCrewNames: visit.confirmedCrewNames, moments: visit.moments });

    const paging = nextRequest();
    const more = read.load("older");
    const oldPage = await paging;
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    expect(oldPage.signal?.aborted).toBe(true);
    expect(read.snapshot()).toMatchObject({ visit: null, canSubscribe: false });

    const foreground = nextRequest();
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    page.dispatchEvent(new Event("visibilitychange"));
    expect(read.snapshot()).toMatchObject({ visit: null, loading: true, canSubscribe: false });
    const denied = settled(read);
    (await foreground).response.resolve(Response.json({ ok: false, error: { code: "NOT_FOUND" }, meta }, { status }));
    expect(await denied).toEqual({ visit: null, failed: true, loading: false, canSubscribe: false });

    oldPage.response.resolve(Response.json({ ok: true, data: visit, meta }));
    await more;
    expect(read.snapshot()).toMatchObject({ visit: null, failed: true });
    expect(urls).toEqual([visitPath, `${visitPath}?cursor=older`, visitPath]);
  } finally { stop(); }
});

test("socket unavailability gates the retained visit while one exact read checks access", async () => {
  const { read, urls, nextRequest } = setup();
  const initialRequest = nextRequest();
  const initial = read.load();
  (await initialRequest).response.resolve(Response.json({ ok: true, data: visit, meta }));
  await initial;
  expect(read.snapshot().visit).toEqual(visit);

  const reauthorization = nextRequest();
  read.reauthorize();
  read.reauthorize();
  expect(read.snapshot()).toMatchObject({ visit: null, loading: true, canSubscribe: true });
  const denied = settled(read);
  (await reauthorization).response.resolve(Response.json({ ok: false, error: { code: "NOT_FOUND" }, meta }, { status: 404 }));
  expect(await denied).toEqual({ visit: null, failed: true, loading: false, canSubscribe: false });
  expect(urls).toEqual([visitPath, visitPath]);
});

test("a pause published after the foreground read appears after socket ready, without an invalidate", async () => {
  const { read, urls, nextRequest } = setup();
  const page = Object.assign(new EventTarget(), { visibilityState: "hidden" as DocumentVisibilityState });
  const stop = read.watchVisibility(page);
  const socket = { close() {} } as WebSocket;
  const subscription = createLiveSubscription(
    { kind: "customer-visit", opaqueId: visit.visitId }, async () => socket,
    () => read.snapshot().canSubscribe, () => ({ onHint: read.hint, onUnavailable: read.reauthorize }),
  );
  try {
    const foreground = nextRequest();
    const opened = settled(read);
    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    (await foreground).response.resolve(Response.json({ ok: true, data: visit, meta }));
    expect((await opened).visit?.live.status).toBe("confirmed");

    const pause = { id: "update-pause", kind: "paused", recordedAt: at + 1, sharedByName: "Foreman", nextUpdateAt: null };
    const published = { ...visit, live: { ...visit.live, status: "paused" }, moments: [pause, ...visit.moments] };
    expect(subscription.connect("always")).toBe(true);
    await Promise.resolve();
    expect(urls).toEqual([visitPath]);

    const ready = new MessageEvent("message", { data: JSON.stringify({ kind: "ready" }) });
    expect(socket.onmessage).toBeFunction();
    const schedule = spyOn(globalThis, "setTimeout");
    const reconciled = nextRequest();
    const refreshed = settled(read);
    try {
      socket.onmessage?.call(socket, ready);
      socket.onmessage?.call(socket, ready);
      expect(schedule).toHaveBeenCalledTimes(1);
    } finally { schedule.mockRestore(); }
    (await reconciled).response.resolve(Response.json({ ok: true, data: published, meta }));
    expect((await refreshed).visit).toMatchObject({ live: { status: "paused" }, moments: [pause, ...visit.moments] });
    expect(urls).toEqual([visitPath, visitPath]);
  } finally {
    subscription.disconnect();
    stop();
  }
});

test("More adopts its live summary and coalesces in-flight hints into one reconciliation", async () => {
  const { read, urls, nextRequest } = setup();
  const initialRequest = nextRequest();
  const initial = read.load();
  const displacedMoment = { ...visit.moments[0], id: "update-displaced", recordedAt: at - 1 };
  (await initialRequest).response.resolve(Response.json({ ok: true, data: { ...visit, moments: [...visit.moments, displacedMoment] }, meta }));
  await initial;

  const older = nextRequest();
  const more = read.load("older");
  const request = await older;
  read.hint();
  read.hint();
  read.hint();
  expect(urls).toEqual([visitPath, `${visitPath}?cursor=older`]);
  const olderMoment = { ...visit.moments[0], id: "update-older", recordedAt: at - 2 };
  const reconciliation = nextRequest();
  request.response.resolve(Response.json({ ok: true, meta, data: {
    ...visit, confirmedCrewNames: ["New Crew"], live: { ...visit.live, status: "paused" },
    moments: [olderMoment], page: { hasMore: false, cursor: null },
  } }));
  await more;
  expect(read.snapshot().visit).toMatchObject({
    live: { status: "paused" }, confirmedCrewNames: ["New Crew"], moments: [...visit.moments, displacedMoment, olderMoment],
  });

  const next = await reconciliation;
  const refreshed = settled(read);
  const newMoment = { ...visit.moments[0], id: "update-new", recordedAt: at + 1 };
  const refreshedMoment = { ...visit.moments[0], sharedByName: "Updated Foreman" };
  next.response.resolve(Response.json({ ok: true, meta, data: {
    ...visit, live: { ...visit.live, status: "no_crew_available" },
    moments: [newMoment, refreshedMoment], page: { hasMore: true, cursor: "new-head" },
  } }));
  expect((await refreshed).visit).toMatchObject({
    live: { status: "no_crew_available" },
    moments: [newMoment, refreshedMoment, displacedMoment, olderMoment],
    page: { hasMore: false, cursor: null },
  });
  expect(urls).toEqual([visitPath, `${visitPath}?cursor=older`, visitPath]);
});

test("More fills the gap when 51 new moments arrive over a fully loaded history", async () => {
  const { read, urls, nextRequest } = setup();
  const moments = Array.from({ length: 102 }, (_, index) => ({
    ...visit.moments[0], id: `update-${index}`, recordedAt: at - index,
  }));
  async function respond(request: ReturnType<typeof nextRequest>, start: number, cursor: string | null) {
    (await request).response.resolve(Response.json({ ok: true, meta, data: {
      ...visit, moments: moments.slice(start, start + 50), page: { hasMore: cursor !== null, cursor },
    } }));
  }
  async function load(start: number, cursor: string | null, after?: string) {
    const request = nextRequest();
    const loaded = read.load(after);
    await respond(request, start, cursor);
    await loaded;
  }

  await load(51, "old-tail");
  await load(101, null, "old-tail");
  expect(read.snapshot().visit).toMatchObject({
    moments: moments.slice(51), page: { hasMore: false, cursor: null },
  });

  const request = nextRequest();
  const refreshed = settled(read);
  read.hint();
  await respond(request, 0, "new-gap");
  const head = (await refreshed).visit;
  expect(head).toMatchObject({
    moments: moments.slice(0, 50), page: { hasMore: true, cursor: "new-gap" },
  });
  await load(50, "new-tail", head?.page.cursor ?? undefined);
  await load(100, null, read.snapshot().visit?.page.cursor ?? undefined);
  expect(read.snapshot().visit).toMatchObject({
    moments, page: { hasMore: false, cursor: null },
  });
  expect(urls).toEqual([visitPath, `${visitPath}?cursor=old-tail`, visitPath, `${visitPath}?cursor=new-gap`, `${visitPath}?cursor=new-tail`]);
});

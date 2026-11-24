import { expect, test } from "bun:test";
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

test("More adopts its live summary and coalesces in-flight hints into one reconciliation", async () => {
  const { read, urls, nextRequest } = setup();
  const initialRequest = nextRequest();
  const initial = read.load();
  (await initialRequest).response.resolve(Response.json({ ok: true, data: visit, meta }));
  await initial;

  const older = nextRequest();
  const more = read.load("older");
  const request = await older;
  read.hint();
  read.hint();
  read.hint();
  expect(urls).toEqual([visitPath, `${visitPath}?cursor=older`]);
  const olderMoment = { ...visit.moments[0], id: "update-older", recordedAt: at - 1 };
  const reconciliation = nextRequest();
  request.response.resolve(Response.json({ ok: true, meta, data: {
    ...visit, confirmedCrewNames: ["New Crew"], live: { ...visit.live, status: "paused" },
    moments: [olderMoment], page: { hasMore: false, cursor: null },
  } }));
  await more;
  expect(read.snapshot().visit).toMatchObject({
    live: { status: "paused" }, confirmedCrewNames: ["New Crew"], moments: [...visit.moments, olderMoment],
  });

  const next = await reconciliation;
  const refreshed = settled(read);
  next.response.resolve(Response.json({ ok: true, meta, data: { ...visit, live: { ...visit.live, status: "no_crew_available" } } }));
  expect((await refreshed).visit?.live.status).toBe("no_crew_available");
  expect(urls).toEqual([visitPath, `${visitPath}?cursor=older`, visitPath]);
});

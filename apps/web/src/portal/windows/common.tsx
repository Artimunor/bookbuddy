import { createFieldClient, createScheduleClient } from "@bookbuddy/api-client";
import type { JobWindows } from "@bookbuddy/api-contract";
import { useEffect, useMemo, useState } from "react";
import { usePortal } from "../now/common";
import { formatPortalTime } from "../time";

export function useScheduleClients() {
  const { api } = usePortal();
  return useMemo(() => ({ schedule: createScheduleClient(api), field: createFieldClient(api) }), [api]);
}
export function currentVisit(data: JobWindows | null, visitId?: string | null) {
  return visitId ? data?.visits.find(v => v.id === visitId) ?? null : data?.visits.find(v => v.offeredWindows.length) ?? data?.visits.find(v => v.bookedWindow && v.state === "booked") ?? data?.visits[0] ?? null;
}
export function useWindows(id: string) {
  const { schedule } = useScheduleClients(); const { bootstrap, activeContext } = usePortal(); const [data, setData] = useState<JobWindows | null>(null); const [failed, setFailed] = useState(false);
  async function refresh(signal?: AbortSignal) { const r = await schedule.getJobWindows(id, signal ? { signal } : undefined); if (signal?.aborted) return; if (r.ok) { setData(r.data); setFailed(false); } else { setData(null); setFailed(true); } }
  useEffect(() => { const controller = new AbortController(); setData(null); setFailed(false); void refresh(controller.signal); return () => controller.abort(); }, [schedule, id, bootstrap?.sessionId, activeContext?.contextId]);
  return { schedule, data, setData, failed, refresh };
}
export function WindowTime({ start, end, zone }: { start: number; end: number; zone: string }) {
  const { locale, bootstrap } = usePortal(); const viewer = bootstrap?.preferences.twoClock ? bootstrap.preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const a = formatPortalTime(start, zone, locale, viewer); const b = formatPortalTime(end, zone, locale, viewer);
  if (!a || !b) return null;
  return <div><div><bdi>{a.site} – {b.site}</bdi></div>{a.viewer && b.viewer && <div><bdi>{a.viewer} – {b.viewer}</bdi></div>}</div>;
}

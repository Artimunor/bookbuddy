import type { JobsPage } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, SegmentedControl, StatusBanner } from "../../ui";
import { Booking, Frame, usePortal } from "../now/common";

type Page = Extract<JobsPage, { audience: "customer" }>;
export function Bookings() {
  const { jobs, t } = usePortal();
  const [params, setParams] = useSearchParams();
  const segment = params.get("segment") === "past" ? "past" : "active";
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setFailed(false);
    void jobs.getJobs({ segment }, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok && result.data.audience === "customer") setPage(result.data); else setFailed(true);
    });
    return () => controller.abort();
  }, [jobs, segment, generation]);
  async function more() {
    if (!page?.page.cursor || loadingMore) return;
    setLoadingMore(true);
    const result = await jobs.getJobs({ segment, cursor: page.page.cursor });
    if (result.ok && result.data.audience === "customer" && result.data.segment === segment) {
      const next = result.data;
      setPage((current) => current?.segment === segment ? { ...next, items: [...current.items, ...next.items] } : current);
    } else setFailed(true);
    setLoadingMore(false);
  }
  return <Frame current="bookings"><h1 className="text-page-title">{t("web.portal.work.bookings")}</h1>
    <SegmentedControl label={t("web.portal.work.segment")} value={segment} options={[{ value: "active", label: t("web.portal.work.active") }, { value: "past", label: t("web.portal.work.past") }]} onValueChange={(value) => setParams({ segment: value })} />
    {!page && !failed && <p role="status">{t("web.portal.work.loading")}</p>}
    {failed && <StatusBanner title={t("web.portal.work.failed")} tone="critical" action={<Button onClick={() => setGeneration((n) => n + 1)}>{t("web.portal.work.retry")}</Button>} />}
    {page && <>{page.items.length ? page.items.map((item) => <Booking key={item.jobId} item={item} />) : <p>{t("web.portal.work.empty")}</p>}{page.page.hasMore && <Button onClick={more} pending={loadingMore}>{t("web.portal.work.more")}</Button>}</>}
  </Frame>;
}

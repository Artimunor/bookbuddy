import { useSession } from "../session";
import { usePortal } from "../now/common";
import { PendingReceiptNotice } from "../session/pending-receipt";
import type { PendingOperationState } from "../session/pending-operation";
import { formatPortalTime } from "../time";
import { Button } from "../../ui";

export function useCloseout() {
  const portal = usePortal();
  const viewerZone = portal.preferences?.twoClock ? portal.preferences.displayZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const time = (at: number, zone: string) => { const clock = formatPortalTime(at, zone, portal.locale, viewerZone); return [clock?.site, clock?.viewer].filter(Boolean).join(" · "); };
  return { ...portal, time };
}

type AuthoredValue = { original: { text: string; language: string }; reading: { status: "ready"; language: string; text: string } | { status: "pending" | "unavailable" } | null };
export function Authored({ value }: { value: AuthoredValue }) {
  const { t } = usePortal();
  return <div className="space-y-1">{value.reading?.status === "ready" && <><p className="text-supporting text-muted">{t("web.portal.closeout.translation", { language: value.reading.language })}</p><p lang={value.reading.language} dir="auto">{value.reading.text}</p></>}{value.reading?.status === "pending" && <p>{t("web.portal.closeout.pendingTranslation")}</p>}{value.reading?.status === "unavailable" && <p>{t("web.portal.closeout.unavailableTranslation")}</p>}<p className="text-supporting text-muted">{t("web.portal.closeout.original", { language: value.original.language })}</p><p lang={value.original.language} dir="auto">{value.original.text}</p></div>;
}


export function CommandState({ status, check }: { status: PendingOperationState; check: () => void }) {
  const { t } = usePortal();
  if (status === "checking") return <div role="alert"><p>{t("web.portal.closeout.checking")}</p><Button onClick={check}>{t("web.portal.closeout.checkAgain")}</Button></div>;
  if (status === "failed") return <p role="alert">{t("web.portal.closeout.failed")}</p>;
  return <PendingReceiptNotice state={status} />;
}
export function useScopeKey() {
  const { account, activeContext } = useSession();
  return `${account?.id ?? ""}:${activeContext?.contextId ?? ""}`;
}

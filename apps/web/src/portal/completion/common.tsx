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
  const { original, reading } = value;
  return <div className="bb-twin-card">
    <div className="bb-twin-reading">
      {reading?.status === "ready" ? <><p className="mb-1 text-caption text-muted">{t("web.portal.closeout.translation", {language:reading.language})}</p><p className="bb-passage" lang={reading.language} dir="auto">{reading.text}</p></>
        : <p className="bb-passage" lang={original.language} dir="auto">{original.text}</p>}
    </div>
    {reading?.status === "ready" && <div className="bb-twin-original"><p className="mb-1 text-caption text-muted">{t("web.portal.closeout.original", {language:original.language})}</p><p className="bb-passage" lang={original.language} dir="auto">{original.text}</p></div>}
    {reading?.status === "pending" && <p className="bb-twin-original text-supporting text-muted">{t("web.portal.closeout.pendingTranslation")}</p>}
    {reading?.status === "unavailable" && <p className="bb-twin-original text-supporting text-muted">{t("web.portal.closeout.unavailableTranslation")}</p>}
  </div>;
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

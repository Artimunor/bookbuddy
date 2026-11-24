import { useEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import type { View } from "react-native";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import type { PendingWork } from "../../repository/repository";
import { useSession } from "../../session";
import type { Disposition } from "../../session/sign-out";
import { useSync } from "../../sync/provider";
import { Button, Sheet, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

export function SignOutSheet({ visible, onClose, onSignOut, returnFocusRef }: {
  visible: boolean;
  onClose: () => void;
  onSignOut?: () => void;
  returnFocusRef?: RefObject<ComponentRef<typeof View> | null>;
}) {
  const t = useT();
  const { inspectPendingWork, persistentWork, signOut } = useSession();
  const { offline } = useApiAccess();
  const { refresh } = useSync();
  const [counts, setCounts] = useState<PendingWork>();
  const [issue, setIssue] = useState<"read" | "remaining" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setCounts(undefined);
    setIssue(null);
    void inspectPendingWork().then((work) => { if (live) setCounts(work); }, () => { if (live) setIssue("read"); });
    return () => { live = false; };
  }, [visible, inspectPendingWork]);

  const remaining = counts && counts.drafts + counts.waiting + counts.checking + counts.media > 0;
  async function sendFirst() {
    if (inFlight.current || offline || !remaining) return;
    inFlight.current = true;
    setBusy(true);
    setIssue(null);
    try {
      const result = await refresh();
      const work = await inspectPendingWork();
      setCounts(work);
      if (result.status !== "confirmed") setIssue("failed");
      else if (work.drafts + work.waiting + work.checking + work.media > 0) setIssue("remaining");
    } catch { setIssue("read"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function close() {
    if (inFlight.current) return;
    setCounts(undefined);
    setIssue(null);
    onClose();
  }

  function finish(disposition: Disposition) {
    if (inFlight.current) return;
    inFlight.current = true;
    onSignOut?.();
    void signOut(disposition);
  }

  return <Sheet visible={visible} title={t("mobile.you.confirmTitle")} closeLabel={t("shared.action.close")}
    returnFocusRef={returnFocusRef} onClose={close}>
    <Copy>{t("mobile.you.confirmOtherDevices")}</Copy>
    <Copy variant="supporting">{t("mobile.you.confirmLocalLock")}</Copy>
    {!counts && !issue && <Copy accessibilityLiveRegion="polite">{t("mobile.you.pendingLoading")}</Copy>}
    {counts && remaining && <>
      <Copy variant="label">{t("mobile.you.pending")}</Copy>
      {counts.drafts > 0 && <Copy>{t("mobile.you.drafts", { count: counts.drafts })}</Copy>}
      {counts.waiting > 0 && <Copy>{t("mobile.you.waiting", { count: counts.waiting })}</Copy>}
      {counts.checking > 0 && <Copy>{t("mobile.you.checking", { count: counts.checking })}</Copy>}
      {counts.media > 0 && <Copy>{t("mobile.you.media", { count: counts.media })}</Copy>}
      <Copy variant="supporting">{persistentWork ? t("mobile.you.keepHint") : t("mobile.you.keepMemoryHint")}</Copy>
      {counts.waiting + counts.checking + counts.media > 0 && <Button label={t("mobile.you.sendFirst")} busy={busy}
        disabled={offline} onPress={() => { void sendFirst(); }} />}
      <Button label={t("mobile.you.keepAndSignOut")} disabled={busy} variant="neutral" onPress={() => finish("keep")} />
    </>}
    {issue && <StatusBanner state="not-sent" label={issue === "read" ? t("mobile.you.pendingFailed")
      : issue === "failed" ? t("mobile.you.sendFailed") : t("mobile.you.sendRemaining")} />}
    {!counts && issue === "read" && <Button label={t("mobile.you.keepAndSignOut")} variant="neutral" onPress={() => finish("keep")} />}
    {counts && issue !== "read" && <Button label={remaining ? t("mobile.you.discardAndSignOut") : t("mobile.you.signOut")} disabled={busy}
      variant="destructive" onPress={() => finish("discard")} />}
  </Sheet>;
}

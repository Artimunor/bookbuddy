import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentRef } from "react";
import { AppState, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocale, useT } from "../i18n";
import type { PendingReview, PendingReviewItem, ScopedRepository } from "../repository/repository";
import { useSync } from "../sync/provider";
import { Button, Card, Sheet } from "../ui/controls";
import { Copy } from "../ui/controls/shared";
import { useBeaconTheme } from "../ui/theme";
import { transferFiles } from "./files";
import type { MediaQueue } from "./queue";

export function PendingWorkBanner({ repository, queue, online }: {
  repository: ScopedRepository; queue: (repo: ScopedRepository) => MediaQueue | null; online: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { color, space } = useBeaconTheme();
  const { busy: syncing, refresh } = useSync();
  const subscribe = useCallback((listener: () => void) => {
    const outbox = repository.subscribe("outbox", listener);
    const media = repository.subscribe("media", listener);
    return () => { outbox(); media(); };
  }, [repository]);
  const getRevision = useCallback(() => repository.revision("outbox") + repository.revision("media"), [repository]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const [result, setResult] = useState<{ repo: ScopedRepository; review: PendingReview }>();
  const [clock, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState<PendingReviewItem>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const review = repository.isActive && result?.repo === repository ? result.review : null;
  const nextAt = review?.nextAt;
  const itemCount = review?.items.length;

  useEffect(() => {
    if (!repository.isActive) return;
    let live = true;
    void repository.listPendingReview().then((value) => {
      if (live) setResult({ repo: repository, review: value });
    }, () => { if (live) setResult(undefined); });
    return () => { live = false; };
  }, [repository, revision, clock]);
  useEffect(() => {
    if (nextAt === undefined) return;
    const check = () => { if (repository.now() >= nextAt) tick((value) => value + 1); };
    const timeout = setTimeout(check, Math.max(0, nextAt - repository.now()));
    const app = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { clearTimeout(timeout); app.remove(); };
  }, [repository, nextAt, clock]);
  useEffect(() => { if (itemCount === 0) { setOpen(false); setDiscard(undefined); } }, [itemCount]);

  async function decide(item: PendingReviewItem, send: boolean) {
    if (!repository.isActive || inFlight.current || (send && (!online || syncing))) return;
    inFlight.current = true; setBusy(true); setFailed(false);
    try {
      const runtime = queue(repository);
      if (item.kind === "media") {
        const changed = send ? await runtime?.sendHeld(item.id)
          : await (runtime ? runtime.remove(item.id) : repository.removeMediaTransfer(item.id, transferFiles.erase));
        if (!changed) setFailed(true);
      } else {
        const action = await repository.decidePendingOperation(item.id, send);
        if (!action) setFailed(true);
        else if (action === "sync") await refresh();
        else if (action === "media") await runtime?.kick();
      }
      setDiscard(undefined);
    } catch { setFailed(true); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!review?.items.length) return null;
  const close = () => { setOpen(false); setDiscard(undefined); };
  const held = review.items.some((item) => item.held);
  const describe = (item: PendingReviewItem) => {
    if (item.kind === "media") return item.file === "photo" ? t("mobile.media.photo") : t("mobile.media.voiceNote");
    switch (item.operation) {
      case "attendance": return t("mobile.pending.attendance");
      case "chat_append": return t("mobile.pending.message");
      case "attachment_link": return t("mobile.photos.progressTitle");
      case "chat_read_mark":
      case "notification_read_mark": return t("mobile.pending.readMark");
    }
  };
  return <>
    <SafeAreaView edges={["top"]} style={{ backgroundColor: color.surface, borderBottomColor: color.separator, borderBottomWidth: 1 }}>
      <View style={{ paddingHorizontal: space.contentInset, flexDirection: "row", gap: space.grid[2], alignItems: "center" }}>
        <Copy variant="supporting" accessibilityLiveRegion="polite" style={{ flex: 1 }}>{held ? t("mobile.pending.bannerHeld") : t("mobile.pending.bannerReview")}</Copy>
        <Button ref={trigger} variant="quiet" label={t("mobile.pending.review")} onPress={() => { setFailed(false); setOpen(true); }} />
      </View>
    </SafeAreaView>
    <Sheet visible={open} title={t("mobile.pending.title")} closeLabel={t("shared.action.close")} onClose={close} returnFocusRef={trigger}>
      {failed && <Copy accessibilityRole="alert">{t("mobile.pending.reviewFailed")}</Copy>}
      {discard ? <>
        <Copy>{t("mobile.pending.discardExplanation")}</Copy>
        <Button label={t("shared.action.cancel")} variant="neutral" disabled={busy} onPress={() => setDiscard(undefined)} />
        <Button label={t("mobile.media.discard")} variant="destructive" busy={busy} onPress={() => { void decide(discard, false); }} />
      </> : review.items.map((item) => <Card key={`${item.kind}:${item.id}`}>
        <Copy variant="sectionTitle">{describe(item)}</Copy>
        <Copy variant="supporting">{date.format(item.createdAt)}</Copy>
        {item.kind === "outbox" && item.checking && <Copy>{t("mobile.pending.checking")}</Copy>}
        {item.held && <>
          {(item.kind === "outbox" || item.canSend) && <Button label={t("mobile.pending.send")} variant="neutral" disabled={!online || busy || syncing} onPress={() => { void decide(item, true); }} />}
          <Button label={t("mobile.media.discard")} variant="quiet" disabled={busy} onPress={() => setDiscard(item)} />
        </>}
      </Card>)}
    </Sheet>
  </>;
}

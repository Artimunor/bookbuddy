import type { ScreenPreview } from "../../preview/screens/types";
import { useFormat } from "../../i18n";
import { previews as offerPreviews } from "../w-03/preview";
import { previews as shiftPreviews } from "../w-04/preview";
import { DecisionSheet, type DecisionMode } from "./Screen";
const noop = () => {};
const OfferBackdrop = offerPreviews.find(({ state }) => state === "open")!.render;
const HeldBackdrop = offerPreviews.find(({ state }) => state === "awaiting-confirmation")!.render;
const ShiftBackdrop = shiftPreviews.find(({ state }) => state === "confirmed")!.render;

function Fixture({ mode, offline }: { mode: DecisionMode; offline: boolean }) {
  const format = useFormat();
  const detail = format.lines(Date.UTC(2026, 10, 24, 8), "Europe/Madrid")?.site;
  const Backdrop = mode === "decline" ? OfferBackdrop : mode === "withdraw" ? HeldBackdrop : ShiftBackdrop;
  return <>
    <Backdrop />
    <DecisionSheet visible mode={mode} detail={detail ? `Terrace door repair · ${detail}` : undefined} offline={offline}
      busy={false} checking={false} failed={false} onClose={noop} onSubmit={noop} />
  </>;
}

export const previews: ScreenPreview[] = (["decline", "withdraw", "dropout", "not-sent"] as const).map(state => ({
  id: "W-05", state, render: () => <Fixture mode={state === "not-sent" ? "dropout" : state} offline={state === "not-sent"} />,
}));

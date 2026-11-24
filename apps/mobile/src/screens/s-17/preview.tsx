import type { ComponentProps } from "react";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { ConfirmView } from "./Screen";

function Fixture({ state }: { state: ComponentProps<typeof ConfirmView>["state"] }) {
  const t = useT();
  return <ConfirmView state={state} request={{
    title: t("mobile.confirm.example.title"), actionLabel: t("mobile.confirm.example.action"), actionLabelKey: "mobile.confirm.example.action",
    item: t("mobile.confirm.example.item"), actor: t("mobile.confirm.example.actor"), role: t("mobile.confirm.example.role"),
    effects: [t("mobile.confirm.example.effect1"), t("mobile.confirm.example.effect2"), t("mobile.confirm.example.effect3")],
    onConfirm: async () => "confirmed", onReview: () => {},
  }} onConfirm={() => {}} onClose={() => {}} onReview={() => {}} />;
}

export const previews: ScreenPreview[] = [
  { id: "S-17", state: "ready", render: () => <Fixture state="ready" /> },
  { id: "S-17", state: "processing", render: () => <Fixture state="processing" /> },
  { id: "S-17", state: "invalidated", render: () => <Fixture state="invalidated" /> },
  { id: "S-17", state: "uncertain", render: () => <Fixture state="uncertain" /> },
];

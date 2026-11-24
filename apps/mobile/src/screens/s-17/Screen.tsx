import { useNetworkState } from "expo-network";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { useT } from "../../i18n";
import { Dialog } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { confirmationRequest, forgetConfirmation, type ConfirmRequest } from "./confirmAction";

type State = "ready" | "processing" | "invalidated" | "uncertain";

export default function ConfirmScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const request = confirmationRequest(id);
  const network = useNetworkState();
  const offline = !!request && request.serverAction !== false && (request.offline || network.isConnected === false || network.isInternetReachable === false);
  const [state, setState] = useState<State>("ready");
  const inFlight = useRef(false);
  useEffect(() => () => { forgetConfirmation(id); }, [id]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!inFlight.current) router.back();
      return true;
    });
    return () => subscription.remove();
  }, [router]);
  const close = () => { if (!inFlight.current) router.back(); };
  async function submit() {
    if (!request || inFlight.current || state !== "ready" || offline) return;
    inFlight.current = true;
    setState("processing");
    try {
      const result = await request.onConfirm();
      if (result === "confirmed") { inFlight.current = false; router.back(); }
      else setState(result);
    } catch { setState("uncertain"); }
    finally { inFlight.current = false; }
  }
  const review = () => { if (request) { close(); request.onReview(); } };
  return <><Stack.Screen options={{ presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
    <ConfirmView request={request && { ...request, offline }} state={state} onClose={close} onConfirm={() => { void submit(); }} onReview={review} /></>;
}

export function ConfirmView({ request, state, onClose, onConfirm, onReview }: {
  request?: ConfirmRequest; state: State; onClose: () => void; onConfirm: () => void; onReview: () => void;
}) {
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const invalid = state === "invalidated" || !request;
  const title = request ? request.title : t("mobile.confirm.unavailable");
  const action = invalid ? t("mobile.confirm.review") : request!.actionLabel;
  return <Dialog visible title={title} closeLabel={t("shared.action.close")} onClose={onClose} returnFocusRef={request?.returnFocusRef}
    cancel={{ label: t("shared.action.cancel"), onPress: onClose, disabled: state === "processing" }}
    confirm={{ label: action, onPress: invalid ? onReview : onConfirm, variant: request?.destructive ? "destructive" : "primary",
      disabled: !request || state === "processing" || state === "uncertain" || (!invalid && !!request.offline), busy: state === "processing" }}>
    {request && <>
      <View style={{ backgroundColor: color.subtle, padding: space.grid[4], borderRadius: radius.input }}><Copy>{request.item}</Copy></View>
      <Copy>{request.actor} · {request.role}</Copy>
      {request.effects.map((effect, index) => <View key={index} style={{ flexDirection: "row", gap: space.grid[3] }}><Copy accessible={false}>✓</Copy><Copy style={{ flex: 1 }}>{effect}</Copy></View>)}
      {request.offline && <Copy accessibilityLiveRegion="polite">{t("mobile.confirm.offline")}</Copy>}
      {state === "invalidated" && <Copy accessibilityLiveRegion="polite">{t("mobile.confirm.invalidated")}</Copy>}
      {state === "uncertain" && <Copy accessibilityLiveRegion="polite">{t("mobile.confirm.uncertain")}</Copy>}
    </>}
  </Dialog>;
}

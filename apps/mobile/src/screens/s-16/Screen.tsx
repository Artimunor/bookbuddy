import { idSchema, submitSupportRoute } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useApiClient } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, ListRow, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

type Reason = "generic" | "expired" | "removed" | "pending";
type FormState = "editing" | "sending" | "sent" | "invalid" | "unavailable" | "uncertain";
const roots = { customer: "/c/now", foreman: "/f/now", worker: "/w/now", provider_admin: "/p/now" } as const;

export default function HelpScreen() {
  const params = useLocalSearchParams<{ reason?: string; reference?: string; lastConfirmed?: string }>();
  const router = useRouter();
  const { session } = useSession();
  const client = useApiClient();
  const format = useFormat();
  const requestedReason = params.reason;
  const reason: Reason = requestedReason === "expired" || requestedReason === "removed" ? requestedReason
    : requestedReason === "pending" || requestedReason === "pending-eligibility" ? "pending" : "generic";
  const reference = typeof params.reference === "string" && idSchema.safeParse(params.reference).success ? params.reference : undefined;
  const date = typeof params.lastConfirmed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.lastConfirmed) ? new Date(`${params.lastConfirmed}T00:00:00Z`) : null;
  const confirmedClock = date && Number.isFinite(date.getTime()) ? format.siteTime(date.getTime(), "UTC") : null;
  const lastConfirmed = confirmedClock?.kind === "available" ? confirmedClock.site.date : undefined;
  const role = session?.activeContext?.role;
  const [form, setForm] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("editing");
  const [receipt, setReceipt] = useState<string>();
  const inFlight = useRef(false);
  const safeBack = () => {
    if (reason === "generic" && router.canGoBack()) router.back();
    else router.replace((role ? roots[role] : "/welcome") as Href);
  };

  async function send() {
    if (inFlight.current || state === "uncertain" || state === "sent") return;
    const payload = { kind: "access" as const, message: message.trim(), ...(reference && { reference }), ...(email.trim() && { replyEmail: email.trim() }) };
    const input = { body: { operationId: uuid.v4(), payload } };
    if (!submitSupportRoute.input.safeParse(input).success) { setState("invalid"); return; }
    if (!client) { setState("unavailable"); return; }
    inFlight.current = true;
    setState("sending");
    try {
      const result = await client.request(submitSupportRoute, input);
      if (result.ok) { setReceipt(result.data.reference); setState("sent"); }
      else if ("delivery" in result.error && result.error.delivery === "unknown") setState("uncertain");
      else setState("unavailable");
    } catch { setState("uncertain"); }
    finally { inFlight.current = false; }
  }
  return <HelpView reason={reason} reference={reference} lastConfirmed={lastConfirmed} signedIn={!!role} accountAttached={!!session}
    providerAdmin={role === "provider_admin"} form={form} message={message} email={email} state={state} receipt={receipt}
    onMessage={setMessage} onEmail={setEmail} onContact={() => setForm(true)} onSend={() => { void send(); }}
    onBack={safeBack} onEligibility={() => router.push("/p/eligibility" as Href)} />;
}

export function HelpView({ reason, reference, lastConfirmed, signedIn, accountAttached, providerAdmin, form, message, email, state, receipt,
  onMessage, onEmail, onContact, onSend, onBack, onEligibility }: {
  reason: Reason; reference?: string; lastConfirmed?: string; signedIn: boolean; accountAttached?: boolean; providerAdmin?: boolean;
  form: boolean; message: string; email: string; state: FormState; receipt?: string;
  onMessage: (value: string) => void; onEmail: (value: string) => void; onContact: () => void;
  onSend: () => void; onBack: () => void; onEligibility: () => void;
}) {
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const generic = reason === "generic";
  const title = generic ? t("mobile.help.generic.title")
    : reason === "removed" ? t("mobile.help.removed.title") : reason === "pending" ? t("mobile.help.pending.title") : t("mobile.help.expired.title");
  const detail = generic ? t("mobile.help.generic.detail")
    : reason === "removed" ? t("mobile.help.removed.detail") : reason === "pending"
      ? lastConfirmed ? t("mobile.help.pending.last", { date: lastConfirmed }) : null : t("mobile.help.expired.detail");
  const locked = state === "sending" || state === "uncertain" || state === "sent";
  const issue = state === "invalid" ? t("mobile.help.form.invalid") : state === "unavailable" ? t("mobile.help.form.unavailable")
    : state === "uncertain" ? t("mobile.help.form.uncertain") : state === "sent" ? t("mobile.help.form.sent") : null;
  return <Screen title={form ? t("mobile.help.form.title") : t("mobile.help.title")}
    navigation={{ kind: "back", label: t("shared.action.back"), onPress: onBack }}
    dock={<Dock primary={{ label: generic ? t("shared.action.back")
      : signedIn ? t("mobile.help.backNow") : t("mobile.help.backWelcome"), onPress: onBack }} />}>
    {!form ? <>
      <Card>
        {!generic && <View aria-hidden style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center", backgroundColor: color.attentionSoft, borderRadius: radius.pill }}>
          <SymbolView name={{ ios: "link", android: "link", web: "link" }} size={24} tintColor={color.attentionInk} />
        </View>}
        <View style={{ gap: space.grid[2] }}><Copy variant="sectionTitle" accessibilityRole="header">{title}</Copy>{detail && <Copy>{detail}</Copy>}</View>
      </Card>
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.help.options")}</Copy>
      <Card dense>{!generic && <ListRow glyph="↗" label={t("mobile.help.newLink")} description={t("mobile.help.newLink.detail")} />}
        <ListRow glyph="?" label={t("mobile.help.contact")} description={t("mobile.help.contact.detail")} onPress={onContact} />
        {reason === "pending" && providerAdmin && <ListRow label={t("mobile.help.eligibility")} onPress={onEligibility} />}</Card>
      {reference && <View style={{ backgroundColor: color.subtle, paddingHorizontal: space.grid[4], paddingVertical: space.grid[2], borderRadius: radius.pill, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.grid[2] }}>
        <Copy variant="supporting">{t("mobile.help.reference")}</Copy><Copy variant="label" selectable accessibilityLabel={reference.split("").join(" ")} style={{ writingDirection: "ltr" }}>{reference}</Copy></View>}
      {!generic && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.help.privacy")}</Copy>}
    </> : <>
      <Copy>{t("mobile.help.form.explainer")}</Copy>{accountAttached && <Copy>{t("mobile.help.form.identity")}</Copy>}<Copy>{t("mobile.help.form.kind")}</Copy>
      {reference && <Copy selectable style={{ writingDirection: "ltr" }}>{t("mobile.help.reference")}: {reference}</Copy>}
      <TextField label={t("mobile.help.form.message")} value={message} onChangeText={onMessage} multiline maxLength={2000} readOnly={locked} />
      <TextField label={t("mobile.help.form.email")} value={email} onChangeText={onEmail} inputMode="email" autoCapitalize="none" autoCorrect={false} readOnly={locked} />
      {issue && <Copy accessibilityLiveRegion="polite">{issue}</Copy>}
      {receipt && <Copy selectable style={{ writingDirection: "ltr" }}>{t("mobile.help.reference")}: {receipt}</Copy>}
      <Button label={t("mobile.help.form.send")} onPress={onSend} disabled={locked} busy={state === "sending"} />
    </>}
  </Screen>;
}

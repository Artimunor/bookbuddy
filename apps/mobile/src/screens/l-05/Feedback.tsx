import type { CustomerSessionBooking } from "@bookbuddy/api-contract";
import { View } from "react-native";
import { useT } from "../../i18n";
import { Dock, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ChoiceRadio } from "../s-12/ChoiceRadio";

export type FeedbackDraft = { stars: number; comment: string };

export function FeedbackSheet({ booking, draft, onChange, onClose, onReview }: {
  booking: CustomerSessionBooking; draft: FeedbackDraft; onChange: (value: FeedbackDraft) => void;
  onClose: () => void; onReview: () => void;
}) {
  const t = useT();
  const valid = draft.stars >= 1 && draft.stars <= 5;
  return <Sheet visible title={t("mobile.laterCustomer.rateSession")} closeLabel={t("mobile.laterCustomer.close")} onClose={onClose}
    dock={<Dock context={valid ? t("mobile.aftercare.optional") : t("mobile.aftercare.choose")}
      primary={{ label: t("mobile.laterCustomer.reviewRating"), onPress: onReview, disabled: !valid }} />}>
    <Copy variant="supporting">{booking.reference} · {booking.agreement.version.title} · {booking.provider.name}</Copy>
    <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.laterCustomer.rateSession")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      {[1, 2, 3, 4, 5].map(stars => <ChoiceRadio key={stars} pill label={`★ ${stars}`} accessibilityLabel={t("mobile.aftercare.stars", { count: stars })}
        selected={draft.stars === stars} onPress={() => onChange({ ...draft, stars })} />)}
    </View>
    <TextField label={t("mobile.aftercare.comment")} value={draft.comment} onChangeText={comment => onChange({ ...draft, comment })} multiline maxLength={16000} />
    <Copy variant="supporting">{t("mobile.laterCustomer.feedbackAudience")}</Copy>
  </Sheet>;
}

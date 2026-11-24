import { native } from "@bookbuddy/design-tokens";
import { StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { DirectedText, Glyph, type TextDirection } from "./parts";

export type TwinBubbleProps = {
  side: "incoming" | "outgoing";
  attribution: string;
  time: string;
  /** Pass the author's exact text and its direction, independent of the app locale. */
  original: { text: string; dir: TextDirection; languageTag?: string };
  translation:
    | { state: "sameLanguage" }
    | { state: "translated"; text: string; label: string; originalLabel: string; languageTag?: string }
    | { state: "pending" | "unavailable"; label: string };
  delivery?: { state: "received" | "queued" | "failed"; label: string };
  /** A correction is a new message, never a rewrite of another message's original. */
  correctionLabel?: string;
};

export function TwinBubble({ side, attribution, time, original, translation, delivery, correctionLabel }: TwinBubbleProps) {
  const { color, type, space, radius } = useBeaconTheme();
  const outgoing = side === "outgoing";
  const queued = delivery?.state === "queued";
  const failed = delivery?.state === "failed";
  const translated = translation.state === "translated";
  const waiting = translation.state === "pending" || translation.state === "unavailable";
  const padding = { paddingHorizontal: space.grid[4], paddingVertical: space.grid[3], gap: space.grid[1] };
  const deliveryInk = queued ? color.attentionInk : failed ? color.criticalInk : color.muted;
  const originalText = (
    <DirectedText dir={original.dir} lang={original.languageTag} style={[type.body, { color: color.ink }]}>{original.text}</DirectedText>
  );

  return (
    <View style={[styles.message, { alignSelf: outgoing ? "flex-end" : "flex-start", rowGap: space.grid[1] }]}>
      <View style={[styles.metadata, { columnGap: space.grid[2] }]}>
        <Text style={[type.supporting, styles.author, { color: color.ink }]}>{attribution}</Text>
        <Text style={[type.supporting, native.tabularNumbers, styles.time, { color: color.muted }]}>{time}</Text>
      </View>
      {correctionLabel && <Text style={[type.caption, { color: color.infoInk }]}>{correctionLabel}</Text>}
      <View style={[styles.bubble, {
        backgroundColor: outgoing ? color.brandSoft : color.surface, borderRadius: radius.card,
        borderColor: queued || failed ? deliveryInk : color.separator, borderStyle: queued ? "dashed" : "solid",
      }]}>
        <View style={padding}>
          {translated ? (
            <>
              <Text style={[type.caption, { color: color.brandInk }]}>{translation.label}</Text>
              <DirectedText lang={translation.languageTag} style={[type.body, { color: color.ink }]}>{translation.text}</DirectedText>
            </>
          ) : originalText}
        </View>
        {translated && (
          <View style={[padding, { backgroundColor: color.subtle }]}>
            <Text style={[type.caption, { color: color.muted }]}>{translation.originalLabel}</Text>
            {originalText}
          </View>
        )}
        {waiting && (
          <View style={[padding, styles.status, { backgroundColor: color.infoSoft, columnGap: space.grid[2] }]}>
            <Glyph mark={translation.state === "pending" ? "…" : "!"} color={color.infoInk} />
            <Text accessibilityLiveRegion="polite" aria-live="polite" style={[type.supporting, styles.statusText, { color: color.infoInk }]}>{translation.label}</Text>
          </View>
        )}
      </View>
      {delivery && <Text style={[type.supporting, { color: deliveryInk }]}>{delivery.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { minWidth: 0, maxWidth: "92%" },
  metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" },
  author: { flexGrow: 1, flexShrink: 1 },
  time: { flexShrink: 1, maxWidth: "100%" },
  bubble: { borderWidth: 1, overflow: "hidden" },
  status: { flexDirection: "row", alignItems: "center" },
  statusText: { flex: 1 },
});

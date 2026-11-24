import { native } from "@bookbuddy/design-tokens";
import { StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { decorative, Glyph } from "./parts";

export type CrewPerson = {
  id: string;
  initials: string;
  name: string;
  role?: string;
  tint?: "personA" | "personB" | "personC" | "personD";
};

export type CrewStatus = "confirmed" | "onTheWay" | "onSite" | "hold" | "gap" | "replaced";
export type CrewMember = CrewPerson & { status: CrewStatus; statusLabel: string };

export type CrewDotsProps = {
  surface?: "neutral" | "capsule" | "fieldCapsule";
} & (
  | {
    audience: "customer";
    /** Pass only the confirmed, customer-visible crew. This branch never renders individual status. */
    people: readonly (CrewPerson & { status?: never; statusLabel?: never })[];
    crewStatusLabel?: string;
    /** Caller-formatted badge for confirmed crew beyond the first three. */
    overflowLabel?: string;
  }
  | { audience: "foreman"; people: readonly CrewMember[] }
);

const metrics = native.componentMetrics.crewDots;
const marks: Record<CrewStatus, string> = {
  confirmed: "✓", onTheWay: "»", onSite: "⌖", hold: "!", gap: "×", replaced: "↔",
};

function Avatar({ person, state, background, stacked }: {
  person: CrewPerson;
  state?: CrewStatus;
  background: string;
  stacked?: boolean;
}) {
  const { color, scheme, type } = useBeaconTheme();
  const colors = native.componentColors[scheme].crewStatusRing;
  const ring = state === "replaced" ? color.infoInk : colors[state ?? "confirmed"];
  const live = state === "onTheWay" || state === "onSite";
  return (
    <View {...decorative} style={[styles.avatarFrame, stacked && { marginStart: -metrics.overlap, borderColor: background }]}>
      <View style={[styles.avatar, { borderColor: ring, backgroundColor: color[person.tint ?? "personA"] }]}>
        <Text allowFontScaling={false} style={[type.supporting, { color: color.ink }]}>{person.initials}</Text>
      </View>
      {state && (
        <View style={[styles.statusMark, { backgroundColor: live ? color.live : background, borderColor: live ? color.onLive : ring }]}>
          <Glyph mark={marks[state]} color={live ? color.onLive : ring} size={metrics.stateGlyphSize - 2} />
        </View>
      )}
    </View>
  );
}

export function CrewDots(props: CrewDotsProps) {
  const { color, type, radius, space, field } = useBeaconTheme();
  const { surface = "neutral", people } = props;
  const background = surface === "fieldCapsule" ? color.live : surface === "capsule" ? color.night : color.surface;
  const ink = surface === "fieldCapsule" ? color.onLive : surface === "capsule" ? color.onNight : color.ink;
  const muted = surface === "fieldCapsule" ? color.onLive : surface === "capsule" ? color.nightMuted : color.muted;
  if (people.length === 0) {
    return props.audience === "customer" && props.crewStatusLabel
      ? <Text style={[type.supporting, { color: muted }]}>{props.crewStatusLabel}</Text>
      : null;
  }

  if (props.audience === "customer") {
    return (
      <View style={[styles.customer, { gap: space.grid[2] }]}>
        <View style={[styles.stack, { gap: space.grid[1] }]}>
          {props.people.slice(0, metrics.visibleCount).map((person, i) => (
            <Avatar key={person.id} person={person} stacked={i > 0} background={background} />
          ))}
          {people.length > metrics.visibleCount && props.overflowLabel && (
            <View {...decorative} style={[styles.overflow, { backgroundColor: surface === "neutral" ? color.subtle : background, borderColor: muted, borderRadius: radius.pill }]}>
              <Text style={[type.caption, native.tabularNumbers, { color: ink }]}>{props.overflowLabel}</Text>
            </View>
          )}
        </View>
        <View style={styles.identity}>
          {props.people.map((person) => (
            <Text key={person.id} style={[type.supporting, { color: ink }]}>
              {person.name}{person.role && <Text style={{ color: muted }}>{" · "}{person.role}</Text>}
            </Text>
          ))}
          {props.crewStatusLabel && <Text style={[type.supporting, { color: muted }]}>{props.crewStatusLabel}</Text>}
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: space.grid[2] }}>
      {props.people.map((person) => (
        <View key={person.id} style={[styles.member, { gap: space.grid[3], minHeight: native.ergonomics[field ? "field" : "standard"].rowMinHeight }]}>
          <Avatar person={person} state={person.status} background={background} />
          <View style={styles.identity}>
            <Text style={[type.label, { color: ink }]}>{person.name}</Text>
            {person.role && <Text style={[type.supporting, { color: muted }]}>{person.role}</Text>}
            <Text style={[type.supporting, { color: ink }]}>{person.statusLabel}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  customer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  stack: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", maxWidth: "100%" },
  avatarFrame: { borderWidth: 2, borderColor: "transparent", borderRadius: native.radii.pill },
  avatar: {
    width: metrics.avatarSize, height: metrics.avatarSize, borderRadius: metrics.avatarSize / 2,
    borderWidth: metrics.statusRingWidth, alignItems: "center", justifyContent: "center",
  },
  statusMark: {
    position: "absolute", bottom: -2, end: -2, width: metrics.stateGlyphSize, height: metrics.stateGlyphSize,
    borderRadius: metrics.stateGlyphSize / 2, borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
  overflow: { minWidth: metrics.avatarSize, minHeight: metrics.avatarSize, borderWidth: 1, paddingHorizontal: native.spacing.grid[2], alignItems: "center", justifyContent: "center" },
  identity: { flex: 1, minWidth: 0 },
  member: { flexDirection: "row", alignItems: "center" },
});

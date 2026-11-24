import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BeaconThemeProvider, useBeaconTheme } from "../theme";
import {
  ArrivalBand, CrewDots, HoldBanner, JobLine, LiveCapsule, OfferClock, Stamp, TwinBubble, TwoClock,
  type CrewMember, type CrewPerson, type LiveCapsuleProps,
} from "./index";

const day = ["Confirmed", "On the way", "On site", "Working", "Finished"] as const;
const journey = ["Requested", "Quoted", "Booked", "Visit", "Signed off", "Paid"] as const;
const confirmedCrew = [
  { id: "mateo", initials: "MR", name: "Mateo Ruiz", tint: "personB" },
  { id: "diego", initials: "DT", name: "Diego Torres", tint: "personD" },
] as const satisfies readonly CrewPerson[];
const arrival = { siteTime: "09:10–09:20", siteZone: "Spain time", viewerLine: "08:10–08:20 your time" };
const checkIn = { kind: "attendance", title: "Crew checked in", time: "09:14 Spain time", attribution: "Mateo Ruiz · Foreman" } as const;
const spanish = { text: "Llegaremos entre las 09:10 y las 09:20.", dir: "ltr", languageTag: "es" } as const;
const photo = {
  uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAl0lEQVRjuH/j1KBCDIPUQe8fnUVDLk42tEOY1r1/dHbUQaMhRMc0tPzAIfyoIDOmIDOGoLJRB42G0GgaGjK57NS1k/gRxEEElY06aDSERtPQaC4jtxyavrwHP4KUQwSVUa0cGnUQoRCCxAjlaDTKRhP1aLYfLYeGTUk9Oj40CENoXXfmgKNRB42G0GgaGs1lg6ocGjyIYcBdgIYA+IUBVwAAAABJRU5ErkJggg==",
};

const capsuleCards: readonly {
  state: LiveCapsuleProps["state"]; name: string; stage: 0 | 1 | 2 | 3 | 4; time: string; provenance: string;
}[] = [
  { state: "crewConfirmed", name: "Crew confirmed", stage: 0, time: "09:00–10:00", provenance: "Confirmed by Mateo · 08:30 Spain time" },
  { state: "coverBeingArranged", name: "Cover being arranged", stage: 0, time: "09:00–10:00", provenance: "Mateo will update you by 08:45 Spain time" },
  { state: "crewChanged", name: "Crew changed · Same window", stage: 0, time: "09:00–10:00", provenance: "Updated by Mateo · 08:40 Spain time" },
  { state: "onSite", name: "Crew on site", stage: 2, time: "09:14", provenance: "Checked in by Mateo · 09:14 Spain time" },
  { state: "working", name: "Working", stage: 3, time: "09:18", provenance: "Shared by Mateo · 09:18 Spain time" },
  { state: "noUpdateSince", name: "No update since 08:52", stage: 1, time: "09:10–09:20", provenance: "Last confirmed by Mateo · 08:52 Spain time" },
  { state: "quiet", name: "Visit updates are quiet", stage: 2, time: "09:14", provenance: "Last confirmed by Mateo · 09:14 Spain time" },
  { state: "paused", name: "Work paused", stage: 3, time: "09:36", provenance: "Shared by Mateo · 09:36 Spain time" },
  { state: "finished", name: "Finished", stage: 4, time: "10:12", provenance: "Finished by Mateo · 10:12 Spain time" },
];

const foremanCrew: readonly CrewMember[] = [
  { ...confirmedCrew[0], role: "Foreman", status: "onSite", statusLabel: "On site · 09:14 Spain time" },
  { ...confirmedCrew[1], role: "Cover worker", status: "hold", statusLabel: "Waiting for briefing" },
  { id: "lucia", initials: "LO", name: "Lucía Ortega", tint: "personA", status: "confirmed", statusLabel: "Confirmed" },
  { id: "ines", initials: "IV", name: "Inés Vidal", tint: "personC", status: "onTheWay", statusLabel: "On the way" },
  { id: "pau", initials: "PS", name: "Pau Soler", status: "gap", statusLabel: "Crew gap reported" },
  { id: "nadia", initials: "NB", name: "Nadia Benali", tint: "personC", status: "replaced", statusLabel: "Replaced on this visit" },
];

function Example({ title, children }: { title: string; children: ReactNode }) {
  const { color, type, space, radius } = useBeaconTheme();
  return (
    <View style={[styles.example, { backgroundColor: color.surface, borderColor: color.separator, borderRadius: radius.card, padding: space.grid[4], gap: space.grid[3] }]}>
      <Text accessibilityRole="header" style={[type.sectionTitle, { color: color.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

export function LiveGallery() {
  const { color, type, space } = useBeaconTheme();
  return (
    <View style={{ gap: space.grid[6] }}>
      <View testID="live-signature-preview" style={[styles.grid, { gap: space.grid[4] }]}>
        <Example title="01 · Follow a visit">
          <LiveCapsule
            size="hero" state="onTheWay" stateLabel="On the way · arriving" source="Reformas Ruiz" reference="BB-1042"
            time={arrival.siteTime} zoneLine="Spain time · 08:10–08:20 your time" estimate="≈ 14 min"
            provenance="Shared by Mateo · 08:52 Spain time"
            accessibilityLabel="On the way, arriving 09:10–09:20 Spain time, 08:10–08:20 your time. Confirmed crew: Mateo Ruiz and Diego Torres. Shared by Mateo at 08:52 Spain time."
            line={{ kind: "visit", steps: day, current: 1, estimate: { fraction: 0.5, label: "Estimated progress" }, accessibilityLabel: "Step 2 of 5, On the way. Estimated progress." }}
            crew={{ audience: "customer", people: confirmedCrew }}
          />
          <JobLine kind="journey" steps={journey} current={2} accessibilityLabel="Step 3 of 6, Booked." />
          <TwoClock siteTime="09:14" siteZone="Spain time" viewerLine="08:14 your time" />
          <Stamp {...checkIn} />
        </Example>
        <Example title="02 · On site in Field mode">
          <BeaconThemeProvider scheme="dark" field>
            <LiveCapsule
              state="working" stateLabel="Working" source="Terrace door repair" reference="BB-1042" time="09:18"
              zoneLine="Spain time" provenance="Shared by Diego · 09:18 Spain time"
              accessibilityLabel="Working since 09:18 Spain time. Shared by Diego at 09:18 Spain time."
              line={{ kind: "visit", steps: day, current: 3, compact: true, accessibilityLabel: "Step 4 of 5, Working." }}
            />
          </BeaconThemeProvider>
          <OfferClock state="running" deadline="Reply by 08:42 Spain time" remaining="6 min" fraction={0.66} />
          <OfferClock state="expired" deadline="Reply by 08:42 Spain time" statusLabel="Offer expired" />
          <HoldBanner state="briefingRequired" label="Safety hold" blocked="Do not use the terrace door." action="Mateo must verify your briefing before you can acknowledge it." />
        </Example>
        <Example title="03 · Shared in your language">
          <TwinBubble side="incoming" attribution="Nadia Benali · Crew" time="08:36" original={{ text: "سأحضر البكرات الجديدة معي.", dir: "rtl", languageTag: "ar" }}
            translation={{ state: "translated", label: "Translation · English", text: "I’ll bring the new rollers with me.", originalLabel: "Original · العربية", languageTag: "en" }} />
          <ArrivalBand state="onTheWay" label="Arriving" time={arrival} estimate="About 14 minutes" provenance="Shared by Mateo · 08:52 Spain time" />
          <Stamp kind="crew" title="Arrival estimate updated" attribution="Mateo Ruiz · Foreman" time="09:05" detail="09:20–09:30 Spain time" state="corrected" stateLabel="Corrects the 08:52 update" />
        </Example>
      </View>

      <Text accessibilityRole="header" style={[type.pageTitle, { color: color.ink }]}>Capsule states</Text>
      <View style={[styles.grid, { gap: space.grid[4] }]}>
        {capsuleCards.map(({ state, name, stage, time, provenance }) => (
          <View key={state} style={styles.cell}>
            <LiveCapsule state={state} source="Reformas Ruiz" reference="BB-1042" stateLabel={name} time={time} zoneLine="Spain time" provenance={provenance}
              accessibilityLabel={`${name}. ${time} Spain time. ${provenance}.`}
              line={{ kind: "visit", steps: day, current: stage, compact: true, accessibilityLabel: `Step ${stage + 1} of 5, ${day[stage]}.` }} />
          </View>
        ))}
        <View style={styles.cell}>
          <BeaconThemeProvider scheme="dark">
            <LiveCapsule size="pill" state="onSite" stateLabel="Crew on site" source="Reformas Ruiz" time="09:14" provenance="Shared by Mateo · 09:14 Spain time"
              accessibilityLabel="Crew on site since 09:14 Spain time. Shared by Mateo at 09:14 Spain time." />
          </BeaconThemeProvider>
        </View>
        <View style={styles.cell}>
          <LiveCapsule size="pill" state="onTheWay" stateLabel="On the way" source="Reformas Ruiz" time="09:10–09:20 Spain time"
            zoneLine="08:10–08:20 your time" provenance="Shared by Mateo · 08:52"
            accessibilityLabel="On the way, arriving 09:10 to 09:20 Spain time, 08:10 to 08:20 your time." />
        </View>
      </View>

      <Text accessibilityRole="header" style={[type.pageTitle, { color: color.ink }]}>Component states</Text>
      <View style={[styles.grid, { gap: space.grid[4] }]}>
        <Example title="Journey and arrival">
          <JobLine kind="journey" steps={journey} current={5} activity="finished" accessibilityLabel="Step 6 of 6, Paid." />
          <JobLine kind="visit" steps={day} current={0} status={{ state: "delayed", label: "Waiting for an update" }} accessibilityLabel="Step 1 of 5, Confirmed. Waiting for an update." />
          <JobLine kind="visit" steps={day} current={0} status={{ state: "cover", label: "Cover being arranged" }} accessibilityLabel="Step 1 of 5, Confirmed. Cover being arranged." />
          <JobLine kind="journey" steps={journey} current={2} status={{ state: "cancelled", label: "Visit cancelled" }} accessibilityLabel="Step 3 of 6, Booked. Visit cancelled." />
          <ArrivalBand state="window" label="Booked window" time={{ siteTime: "09:00–10:00", siteZone: "Spain time" }} />
          <ArrivalBand state="dueNow" label="Due now" time={arrival} provenance="Last confirmed by Mateo · 08:52 Spain time" />
          <ArrivalBand state="noUpdateSince" label="No update since 08:52" time={arrival} provenance="Last confirmed by Mateo · 08:52 Spain time" />
          <ArrivalBand state="arrived" checkIn={checkIn} />
        </Example>
        <Example title="Cover search">
          <LiveCapsule state="crewConfirmed" stateLabel="Offers out · reply by" source="Cover search" reference="09:00–10:00"
            time="08:42" zoneLine="Spain time" provenance="Visit starts at 09:00"
            accessibilityLabel="Cover search, offers out, reply by 08:42 Spain time. Step 2 of 4."
            coverClock={{ remaining: "6 min", fraction: 2 / 3 }}
            line={{ kind: "cover", steps: ["Gap", "Offers out", "Accepted", "Confirmed"], current: 1, accessibilityLabel: "Step 2 of 4, Offers out" }} />
        </Example>
        <Example title="Crew and timestamps">
          <CrewDots audience="customer" people={[
            ...confirmedCrew,
            { id: "lucia", initials: "LO", name: "Lucía Ortega", tint: "personA" },
            { id: "ines", initials: "IV", name: "Inés Vidal", tint: "personC" },
          ]} overflowLabel="+1" crewStatusLabel="Crew on site" />
          <CrewDots audience="foreman" people={foremanCrew} />
          <TwoClock siteTime="09:14" siteZone="Spain time" />
          <TwoClock siteTime="Tuesday, 00:10" siteZone="Spain time" viewerLine="Monday, 23:10 your time" />
          <Stamp kind="photo" title="Rollers fitted" attribution="Mateo Ruiz · Foreman" time="09:36" photo={{ source: photo, accessibilityLabel: "Illustration of the terrace door after repair" }} />
          <Stamp kind="decision" title="Visit signed off" time="10:40" attribution="Claire Martin · Customer" />
          <Stamp kind="attendance" title="Check-in saved" time="09:14" state="pending" stateLabel="Saved on this device · pending sync" />
          <Stamp kind="system" title="Check-in not accepted" time="09:15" state="rejected" stateLabel="Already checked in from another device" />
          <Stamp kind="crew" title="Arrival estimate withdrawn" time="09:06" state="retracted" stateLabel="Withdraws the 08:52 update" />
        </Example>
        <Example title="Cover offers and briefing">
          <OfferClock state="urgent" deadline="Reply by 08:42 Spain time" remaining="1 min" fraction={0.11} statusLabel="Reply soon" />
          <OfferClock state="accepted" deadline="Confirm by 08:43 Spain time" statusLabel="Place held · awaiting confirmation" />
          <OfferClock state="filled" deadline="Reply by 08:42 Spain time" statusLabel="Cover confirmed" />
          <HoldBanner state="awaitingAcknowledgement" label="Safety hold" blocked="Keep the doorway taped off." action="Diego must acknowledge version 2." />
          <HoldBanner state="cleared" label="Hold cleared" detail="Diego acknowledged version 2 at 09:17 Spain time." />
          <HoldBanner state="superseded" label="Briefing replaced" detail="Version 3 is now in use." />
        </Example>
        <Example title="Message states">
          <TwinBubble side="incoming" attribution="Mateo Ruiz · Foreman" time="08:52" original={spanish}
            translation={{ state: "translated", label: "Translation · English", text: "We’ll arrive between 09:10 and 09:20.", originalLabel: "Original · Español", languageTag: "en" }} />
          <TwinBubble side="incoming" attribution="Mateo Ruiz · Foreman" time="08:52" original={spanish} translation={{ state: "pending", label: "Translating…" }} />
          <TwinBubble side="incoming" attribution="Mateo Ruiz · Foreman" time="08:52" original={spanish} translation={{ state: "unavailable", label: "Translation unavailable · Original shown unchanged" }} />
          <TwinBubble side="outgoing" attribution="Claire Martin · Customer" time="08:03" original={{ text: "Thanks, I’ll leave the gate open.", dir: "ltr", languageTag: "en" }}
            translation={{ state: "sameLanguage" }} delivery={{ state: "queued", label: "Saved on this device · pending sync" }} />
          <TwinBubble side="outgoing" attribution="Claire Martin · Customer" time="08:04" original={{ text: "The side gate, not the driveway.", dir: "ltr", languageTag: "en" }}
            translation={{ state: "sameLanguage" }} correctionLabel="Correction to the 08:03 message" delivery={{ state: "failed", label: "Not sent · check your connection" }} />
        </Example>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  cell: { flexBasis: 318, flexGrow: 1, maxWidth: "100%" },
  example: { flexBasis: 318, flexGrow: 1, maxWidth: "100%", borderWidth: 1 },
});

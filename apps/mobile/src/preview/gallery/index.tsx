import { native } from "@bookbuddy/design-tokens";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Badge, BookingCard, Button, Card, CodeField, Dialog, Dock, EmptyState, IdentityChip, ListRow,
  NeedsYouCard, Screen, SegmentedControl, SettingsRow, Sheet, StatusBanner, SwitchRow, TextField, TwinCard,
} from "../../ui/controls";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import { LiveGallery } from "../../ui/live/Gallery";
import { JobLine } from "../../ui/live/JobLine";

export default function PreviewGallery() {
  return (
    <SafeAreaProvider>
      <BeaconThemeProvider scheme="light">
        <Gallery />
      </BeaconThemeProvider>
    </SafeAreaProvider>
  );
}

const modes = [
  { title: "Light", scheme: "light", field: false, description: "Warm paper · standard controls" },
  { title: "Dark", scheme: "dark", field: false, description: "Night paper · standard controls" },
  { title: "Field", scheme: "light", field: true, description: "Glove-ready · 64 pt controls" },
] as const;

function Gallery() {
  const { color, radius, space, type } = useBeaconTheme();
  const { width, fontScale } = useWindowDimensions();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.canvas }} keyboardShouldPersistTaps="handled">
      <View style={[
        styles.page,
        { paddingHorizontal: width < 600 ? space.grid[4] : space.grid[8], paddingVertical: space.grid[8], gap: space.grid[8] },
      ]}>
        <View style={{ gap: space.grid[2] }}>
          <Text style={[type.caption, { color: color.muted }]}>BOOKBUDDY / BEACON</Text>
          <Text accessibilityRole="header" style={[type.display, { color: color.ink }]}>Mobile UI kit</Text>
          <Text style={[type.body, { color: color.muted }]}>One set of controls for light, dark and work on site.</Text>
        </View>
        <View nativeID="controls-gallery" style={{ flexDirection: width >= 1140 && fontScale < 1.4 ? "row" : "column", gap: space.grid[4] }}>
          {modes.map(({ title, scheme, field, description }) => (
            <BeaconThemeProvider key={title} scheme={scheme} field={field}>
              <ControlExamples title={title} description={description} />
            </BeaconThemeProvider>
          ))}
        </View>
        <View nativeID="live-gallery" style={{ gap: space.grid[4], borderRadius: radius.card }}>
          <Text accessibilityRole="header" style={[type.pageTitle, { color: color.ink }]}>Live components</Text>
          <LiveGallery />
        </View>
      </View>
    </ScrollView>
  );
}

function ControlExamples({ title, description }: { title: string; description: string }) {
  const { color, type, space, radius, field } = useBeaconTheme();
  const metrics = native.ergonomics[field ? "field" : "standard"];
  const [email, setEmail] = useState("claire@example.test");
  const [code, setCode] = useState("");
  const [preference, setPreference] = useState<"site" | "both">("site");
  const [updates, setUpdates] = useState(true);
  const [arrivalNote, setArrivalNote] = useState("We’ll be there between 09:10 and 09:20.");
  const [sheet, setSheet] = useState<"booking" | "identity" | "notifications" | null>(null);
  const [dialog, setDialog] = useState(false);
  const [result, setResult] = useState("");
  const dialogTrigger = useRef<ComponentRef<typeof View>>(null);
  const dismissSheet = () => setSheet(null);
  const dismissDialog = () => setDialog(false);
  const confirmedTime = preference === "both" ? "09:10 Spain time · 08:10 your time" : "09:10 Spain time";
  const sheetTitle = sheet === "identity" ? "Your account" : sheet === "notifications" ? "Updates" : "Share arrival update";

  return (
    <View style={[styles.example, {
      backgroundColor: color.canvas, borderColor: color.outline, borderWidth: metrics.controlBorderWidth,
      borderRadius: radius.card, padding: space.grid[4], gap: space.grid[5],
    }]}>
      <View style={{ gap: space.grid[1] }}>
        <Text accessibilityRole="header" style={[type.pageTitle, { color: color.ink }]}>{title}</Text>
        <Text style={[type.supporting, { color: color.muted }]}>{description}</Text>
      </View>

      <View style={{ height: field ? 548 : 506, backgroundColor: color.surface, borderWidth: 1, borderColor: color.separator, borderRadius: radius.card, overflow: "hidden" }}>
        <Screen
          title="Now"
          navigation={{ kind: "back", label: "Back", onPress: () => setResult("Back returns to your last screen.") }}
          identity={<IdentityChip initials="CM" name="Claire Martin" context="Customer · Villa Mar" onPress={() => setSheet("identity")} />}
          bell={<Button label="Updates" glyph="🔔︎" iconOnly variant="neutral" onPress={() => setSheet("notifications")} />}
          dock={<Dock
            primary={{ label: "Share update", live: true, onPress: () => setSheet("booking") }}
            context="Today’s visit · confirmed"
          />}
        >
          <BookingCard
            title="Terrace door repair"
            place="Villa Mar"
            stage="Booked"
            next={confirmedTime}
            tone="success"
            progress={<JobLine
              kind="journey"
              steps={["Requested", "Quoted", "Booked", "Visit", "Signed off", "Paid"]}
              current={2}
              activity="quiet"
              compact
              accessibilityLabel="Step 3 of 6, Booked"
            />}
            accessibilityLabel={`Terrace door repair, Villa Mar, booked, ${confirmedTime}`}
            onPress={() => setSheet("booking")}
          />
        </Screen>
      </View>

      <Section title="Actions">
        <Button label="Request a visit" onPress={() => setResult("Visit request selected.")} />
        <Button label="Next" variant="neutral" arrow="next" onPress={() => setResult("Next step selected.")} />
        <Button label="Saving…" busy onPress={() => setResult("Saved.")} />
        <Button label="Continue" disabledReason="Choose a visit window first." onPress={() => setResult("Visit window selected.")} />
        <Button label="Open sheet" variant="quiet" onPress={() => setSheet("booking")} />
        <Button label="Cancel visit" ref={dialogTrigger} variant="destructive" onPress={() => setDialog(true)} />
        {!!result && <Text accessibilityLiveRegion="polite" style={[type.supporting, { color: color.muted }]}>{result}</Text>}
      </Section>

      <Section title="Fields and choices">
        <TextField
          label="Email address"
          value={email}
          onChangeText={setEmail}
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          helper="We’ll send a sign-in code."
          error={email && !email.includes("@") ? "Enter an email address with an @ sign." : undefined}
        />
        <CodeField label="Six-digit code" value={code} onChangeText={setCode} placeholder="000000" helper="You can paste the whole code." />
        <SegmentedControl
          label="Visit time"
          options={[{ value: "site", label: "Site time" }, { value: "both", label: "Both clocks" }]}
          value={preference}
          onChange={setPreference}
        />
      </Section>

      <Section title="Rows and settings">
        <ListRow label="Booking details" description="Window, place and confirmed crew" onPress={() => setSheet("booking")} />
        <SettingsRow label="Language" value="English" description="Used for BookBuddy’s controls" />
        <SwitchRow label="Visit updates" description="Show one notice when the visit changes." value={updates} onValueChange={setUpdates} />
      </Section>

      <Section title="Cards">
        <Card>
          <Badge label="Received" tone="success" />
          <Text style={[type.body, { color: color.ink }]}>The provider has received your request.</Text>
        </Card>
        <NeedsYouCard label="Needs you" title="Choose a visit window" description="Mateo sent two times for the repair." action={{ label: "Review times", onPress: () => setSheet("booking") }} />
        <TwinCard
          state="translated"
          title="Visit note"
          translation={{ label: "Translation · English", text: "I’ll bring the new hinge for the terrace door." }}
          original={{ label: "Original · Español", text: "Llevaré la bisagra nueva para la puerta de la terraza.", direction: "ltr" }}
        />
        <TwinCard
          state="pending"
          original={{ label: "Original · العربية", text: "سأحضر المفصلة الجديدة لباب الشرفة.", direction: "rtl" }}
          status="Translation pending"
        />
      </Section>

      <Section title="Connection and empty states">
        <StatusBanner state="offline" label="You’re offline" detail="Last confirmed today at 08:52 Spain time." />
        <StatusBanner state="last-confirmed" label="Last confirmed at 08:52 Spain time" />
        <StatusBanner state="saved-on-device" label="Saved on this device" detail="This update is waiting to sync." />
        <StatusBanner state="not-sent" label="Not sent" detail="Your text is still here." action={{ label: "Try again", onPress: () => setResult("Retry requested.") }} />
        <EmptyState title="No upcoming visits" description="Request a visit to get started." action={{ label: "Request a visit", onPress: () => setResult("Visit request selected.") }} />
      </Section>

      <Sheet
        visible={sheet !== null}
        title={sheetTitle}
        closeLabel="Close"
        onClose={dismissSheet}
        dock={sheet === "booking" ? <Dock
          primary={{ label: "Share with Claire", live: true, onPress: () => { dismissSheet(); setResult("Arrival update shared in this preview."); } }}
          secondary={{ label: "Keep as draft", onPress: () => { dismissSheet(); setResult("Draft kept in this preview."); } }}
        /> : undefined}
      >
        {sheet === "booking" ? (
          <TextField label="Arrival note" value={arrivalNote} onChangeText={setArrivalNote} multiline />
        ) : sheet === "identity" ? (
          <Text style={[type.body, { color: color.ink }]}>Claire Martin · Customer · Villa Mar</Text>
        ) : (
          <Text style={[type.body, { color: color.ink }]}>{updates ? "No new visit updates." : "Visit updates are off."}</Text>
        )}
      </Sheet>
      <Dialog
        visible={dialog}
        title="Cancel this visit?"
        closeLabel="Close"
        onClose={dismissDialog}
        returnFocusRef={dialogTrigger}
        cancel={{ label: "Keep visit", onPress: dismissDialog }}
        confirm={{ label: "Cancel visit", variant: "destructive", onPress: () => { dismissDialog(); setResult("Visit cancelled in this preview."); } }}
      >
        <Text style={[type.body, { color: color.ink }]}>Claire Martin · Villa Mar. This removes the confirmed window for the terrace door repair.</Text>
      </Dialog>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { color, type, field } = useBeaconTheme();
  return (
    <View style={{ gap: native.ergonomics[field ? "field" : "standard"].controlGap }}>
      <Text accessibilityRole="header" style={[type.sectionTitle, { color: color.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignSelf: "center", width: "100%", maxWidth: 1480 },
  example: { flex: 1, minWidth: 0 },
});

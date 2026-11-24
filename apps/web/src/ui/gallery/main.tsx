import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import {
  ActionLink, ArrivalBand, Badge, BookingCard, Button, Card, CodeField, CrewDots, Dialog, Dock, EmptyState,
  LiveCapsule, NeedsYouCard, PortalShell, QuoteTable, SegmentedControl, Sheet, Stamp, StatusBanner, SwitchRow, TextField, TwinBubble,
  TwinCard, TwoClock, type JobLineProps, type PortalShellProps,
} from "..";
import "../../entry/styles.css";
import "./showcase.css";

const navigation: PortalShellProps["nav"] = {
  now: { label: "Now", to: "#now" },
  bookings: { label: "Bookings", to: "#bookings" },
  messages: { label: "Messages", to: "#messages", unread: { value: "1", label: "1 unread" } },
  places: { label: "Places", to: "#places" },
  settings: { label: "Settings", to: "#settings" },
};

const day: JobLineProps = {
  stages: [
    { id: "ready", label: "Confirmed" }, { id: "travel", label: "On the way" }, { id: "arrived", label: "On site" },
    { id: "work", label: "Working" }, { id: "done", label: "Finished" },
  ],
  currentId: "travel", ariaLabel: "Step 2 of 5, On the way; arrival is an estimate.",
  fractionToNext: 0.4, estimateLabel: "Progress toward the shared arrival estimate",
};

const journey: JobLineProps = {
  stages: [
    { id: "request", label: "Requested" }, { id: "quote", label: "Quoted" }, { id: "booked", label: "Booked" },
    { id: "visit", label: "Visit" }, { id: "sign-off", label: "Signed off" }, { id: "paid", label: "Paid" },
  ],
  currentId: "booked", ariaLabel: "Step 3 of 6, Booked", quiet: true,
};

const clocks = { site: { value: "09:10–09:20", zoneLabel: "Spain time" }, viewer: { value: "08:10–08:20", zoneLabel: "your time" } };
const crew = [
  { id: "mateo", initials: "MR", name: "Mateo Ruiz", role: "Foreman", tone: "a" },
  { id: "diego", initials: "DT", name: "Diego Torres", role: "Installer", tone: "b" },
] as const;

function Section({ id, title, label, children }: { id: string; title: string; label: string; children: ReactNode }) {
  return <section className="gallery-section" id={id} aria-labelledby={`${id}-title`}>
    <div><p className="gallery-kicker">{label}</p><h2 id={`${id}-title`} className="text-page-title">{title}</h2></div>
    {children}
  </section>;
}

function Gallery() {
  const { hash } = useLocation();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [field, setField] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [overlay, setOverlay] = useState<"dialog" | "sheet" | null>(null);
  const [feedback, setFeedback] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.fieldMode = String(field);
    root.dir = rtl ? "rtl" : "ltr";
  }, [theme, field, rtl]);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return <PortalShell identity={{ name: "Claire Martin", initials: "CM", detail: "Villa Mar · Customer", to: "#settings" }}
      nav={navigation} current="now" navLabel="Customer portal" skipLabel="Skip to content">
    <header className="gallery-intro" id="now">
      <div>
        <p className="gallery-kicker">Design system / portal</p>
        <h1>Beacon UI gallery<span aria-hidden="true">.</span></h1>
        <p className="text-body text-muted">The customer portal in warm paper, ink, and just enough lime.</p>
      </div>
      <span className="gallery-specimen text-caption">Web specimen <bdi>01</bdi></span>
    </header>

    <Section id="visit" label="01 / VISIT" title="A visit, at a glance">
      <div className="gallery-grid gallery-visit">
        <LiveCapsule to="#activity" size="hero" source="Reformas Ruiz" reference="BB-1042" time="09:10–09:20"
          state={{ kind: "live", label: "Crew on the way" }}
          ariaLabel="Crew on the way, arriving 09:10 to 09:20 Spain time. Shared by Mateo at 08:52 Spain time. Open visit."
          provenance="Shared by Mateo · 08:52 Spain time" stageLine={day} />
        <ArrivalBand state="on-the-way" label="Arriving" clocks={clocks} provenance="Shared by Mateo · 08:52 Spain time" />
      </div>
      <div className="gallery-grid gallery-visit" id="activity">
        <Card title="Visit crew"><CrewDots people={crew} status="on-the-way" statusLabel="On the way" /></Card>
        <Card title="Latest stamp"><Stamp kind="crew" title="Arrival estimate shared" actor={{ name: "Mateo Ruiz", role: "Foreman" }} time="08:52 Spain time" dateTime="2026-11-24T08:52:00+01:00" /></Card>
      </div>
    </Section>

    <Section id="bookings" label="02 / BOOKINGS" title="What needs you">
      <div className="gallery-grid">
        <BookingCard to="#visit" title="Terrace door repair" place="Villa Mar" reference="BB-1042" stage={{ label: "Visit booked", tone: "success" }} stageLine={journey} next="Tue 24 Nov · 09:00–10:00 Spain time" />
        <NeedsYouCard status="Decision due" title="Updated quote" detail="Review a separate change before any additional work begins." deadline="Reply by Fri 27 Nov · Spain time" action={{ label: "Review quote", to: "#quote" }} />
        <Card title="Service windows">
          <StatusBanner title="Waiting for confirmation" detail="Your original visit is still booked." tone="info" />
          <div className="mt-4"><TwoClock site={{ value: "Tue 24 Nov · 00:30", zoneLabel: "Spain time" }} viewer={{ value: "Mon 23 Nov · 23:30", zoneLabel: "your time" }} /></div>
        </Card>
      </div>
    </Section>

    <Section id="messages" label="03 / READING" title="The exact words stay visible">
      <div className="gallery-grid gallery-text">
        <div className="grid content-start gap-3">
          <TwinBubble author={{ name: "Mateo Ruiz", role: "Foreman" }} time="08:52"
            original={{ text: "Llegaremos a Villa Mar entre las 09:10 y las 09:20.", lang: "es" }}
            reading={{ state: "translated", passage: { text: "We’ll arrive at Villa Mar between 09:10 and 09:20.", lang: "en" }, originalLabel: "Original · Spanish" }} />
          <TwinBubble author={{ name: "Nadia Benali" }} time="08:55" outgoing
            original={{ text: "سأنتظر عند المدخل الرئيسي.", lang: "ar" }} reading={{ state: "pending", label: "Translation pending" }} />
        </div>
        <TwinCard title="Quote scope" original={{ text: "Sustituir los rodillos de la puerta de la terraza y comprobar su cierre.", lang: "es" }}
          reading={{ state: "translated", passage: { text: "Replace the terrace-door rollers and test that the door closes properly.", lang: "en" },
            translationLabel: "Reading copy · English", originalLabel: "Issued original · Spanish" }}
          footer={<Badge label="Issued original retained" tone="neutral" glyph="decision" />} />
      </div>
    </Section>

    <Section id="quote" label="04 / QUOTE" title="Compare without guessing">
      <QuoteTable caption="Terrace door repair · Quote comparison" compare
        labels={{ item: "Line item", quantity: "Qty", amount: "Amount", previous: "Version 1", current: "Version 2", missing: "Not included" }}
        lines={[
          { id: "labour", label: "Labour", previous: { quantity: "1", amount: "€160.00" }, current: { quantity: "1", amount: "€160.00" } },
          { id: "rollers", label: "Replacement rollers", previous: { quantity: "2", amount: "€80.00" }, current: { quantity: "2", amount: "€80.00" } },
          { id: "guide", label: "Door guide", changeLabel: "Added in version 2", previous: null, current: { quantity: "1", amount: "€40.00" } },
        ]}
        totals={[{ id: "total", label: "Total", previous: "€240.00", current: "€280.00", emphasis: true }]} />
    </Section>

    <Section id="settings" label="05 / CONTROLS" title="Built for different conditions">
      <div className="gallery-grid gallery-text">
        <Card title="Fields and actions">
          <div className="gallery-fields">
            <TextField label="Your email address" type="email" autoComplete="email" defaultValue="claire@example.test" hint="Use the address on your booking." />
            <CodeField label="Verification code" defaultValue="18293" error="Enter the full six-digit code." />
            <div className="flex flex-wrap gap-control-gap">
              <Button variant="secondary" onClick={() => setOverlay("dialog")}>Open dialog</Button>
              <Button variant="secondary" onClick={() => setOverlay("sheet")}>Open sheet</Button>
            </div>
          </div>
        </Card>
        <Card title="Appearance">
          <div className="gallery-fields">
            <SegmentedControl label="Colour theme" options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={theme} onValueChange={setTheme} />
            <SwitchRow label="Field mode" description="Larger controls and an ink-on-lime live surface." checked={field} onCheckedChange={setField} />
            <SwitchRow label="Right-to-left preview" description="Mirror layout and arrows; keep clocks and numbers intact." checked={rtl} onCheckedChange={setRtl} />
          </div>
        </Card>
      </div>
    </Section>

    <Section id="places" label="06 / STATES" title="Keep the next step clear">
      <div className="gallery-grid gallery-text">
        <Card><EmptyState glyph="pin" title="No other places yet" detail="Add a place before making a request for a different address." action={<ActionLink to="#settings" variant="secondary">Add a place</ActionLink>} /></Card>
        <div className="grid content-start gap-3">
          <StatusBanner title={feedback ? "Example updated" : "Example ready"} detail="This gallery does not change real bookings." tone="success" announce="polite" />
          <div className="gallery-dock-frame"><Dock context="Gallery example · no data is sent"
            primary={{ label: "Share live update", live: true, onClick: () => setFeedback(true) }}
            secondary={{ label: "Back to visit", to: "#visit" }} /></div>
        </div>
      </div>
    </Section>

    <Dialog title="Review confirmation" description="The provider, version and effect should always be clear before a decision." closeLabel="Close"
      open={overlay === "dialog"} onOpenChange={(open) => !open && setOverlay(null)}
      footer={<div className="flex flex-wrap gap-control-gap">
        <Button variant="secondary" onClick={() => setOverlay(null)}>Cancel</Button>
        <Button onClick={() => setOverlay(null)}>Confirm example</Button>
      </div>}>
      <p>Claire Martin is reviewing the fictional version 2 of the terrace-door repair quote.</p>
    </Dialog>
    <Sheet title="Visit details" closeLabel="Close" open={overlay === "sheet"} onOpenChange={(open) => !open && setOverlay(null)}
      footer={<Dock primary={{ label: "Done", onClick: () => setOverlay(null) }} />}>
      <div className="grid gap-4"><ArrivalBand state="window" label="Booked visit window" clocks={clocks} />
      <CrewDots people={crew} status="confirmed" statusLabel="Crew confirmed" /></div>
    </Sheet>
  </PortalShell>;
}

const root = document.getElementById("gallery");
if (!root) throw new Error("Missing gallery root");
createRoot(root).render(<BrowserRouter><Gallery /></BrowserRouter>);

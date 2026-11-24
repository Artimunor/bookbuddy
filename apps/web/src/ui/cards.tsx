import { useId, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { ActionLink } from "./controls";
import { Glyph, type GlyphName } from "./glyph";
import { JobLine, type JobLineProps } from "./live";

const toneGlyphs = { neutral: "info", info: "info", success: "check", attention: "clock", critical: "alert" } as const;
type Tone = keyof typeof toneGlyphs;

type BadgeProps = { label: string; tone?: Tone; glyph?: GlyphName };

export function Badge({ label, tone = "neutral", glyph }: BadgeProps) {
  return <span className="bb-badge bb-tone" data-tone={tone}><Glyph name={glyph ?? toneGlyphs[tone]} />{label}</span>;
}

export function Card({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  const Container = title ? "section" : "div";
  return (
    <Container className="bb-card" aria-labelledby={title ? id : undefined}>
      {title && <h2 className="text-section-title" id={id}>{title}</h2>}
      <div className="min-w-0">{children}</div>
      {footer && <div className="bb-card-footer">{footer}</div>}
    </Container>
  );
}

export type BookingCardProps = {
  to: To;
  title: string;
  place: string;
  reference?: string;
  stage: BadgeProps;
  stageLine?: Omit<JobLineProps, "compact" | "surface">;
  next?: ReactNode;
};

export function BookingCard({ to, title, place, reference, stage, stageLine, next }: BookingCardProps) {
  return (
    <article>
      <Link to={to} className="bb-card bb-booking-card">
        <div className="bb-card-heading">
          <div className="min-w-0">
            <h3 className="text-label" dir="auto">{title}</h3>
            <p className="text-supporting text-muted"><bdi>{place}</bdi></p>
          </div>
          {reference
            ? <bdi className="text-caption text-muted tabular-nums">{reference}</bdi>
            : <Glyph name="chevron" />}
        </div>
        <div><Badge {...stage} /></div>
        {stageLine && <JobLine {...stageLine} compact />}
        {next && (typeof next === "string" ? <p className="text-supporting"><bdi>{next}</bdi></p> : next)}
      </Link>
    </article>
  );
}

export type NeedsYouCardProps = {
  status?: string;
  title: string;
  detail: string;
  deadline?: ReactNode;
  action: { label: string; to: To };
};

export function NeedsYouCard({ status, title, detail, deadline, action }: NeedsYouCardProps) {
  return (
    <article className="bb-card bb-tone" data-tone="attention">
      {status && <div><Badge label={status} tone="attention" /></div>}
      <div>
        <h3 className="text-section-title" dir="auto">{title}</h3>
        <p className="mt-1" dir="auto">{detail}</p>
        {deadline && (typeof deadline === "string" ? <p className="mt-2 text-supporting tabular-nums"><bdi>{deadline}</bdi></p> : <div className="mt-2">{deadline}</div>)}
      </div>
      <div><ActionLink to={action.to}>{action.label}</ActionLink></div>
    </article>
  );
}

export type StatusBannerProps = {
  title: string;
  detail?: string;
  tone?: Tone;
  announce?: "polite" | "assertive";
  action?: ReactNode;
};

export function StatusBanner({ title, detail, tone = "info", announce, action }: StatusBannerProps) {
  return (
    <div className="bb-banner bb-tone" data-tone={tone}>
      <Glyph name={toneGlyphs[tone]} />
      <div className="min-w-0" role={announce === "assertive" ? "alert" : announce === "polite" ? "status" : undefined}>
        <p className="text-label">{title}</p>
        {detail && <p className="mt-1 text-supporting">{detail}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export type EmptyStateProps = { title: string; detail: string; glyph?: GlyphName; action?: ReactNode };

export function EmptyState({ title, detail, glyph = "info", action }: EmptyStateProps) {
  return (
    <div className="bb-empty">
      <span className="bb-empty-icon"><Glyph name={glyph} /></span>
      <div><h3 className="text-section-title">{title}</h3><p className="mt-1 text-muted">{detail}</p></div>
      {action && <div>{action}</div>}
    </div>
  );
}

export type AuthoredPassage = { text: string; lang?: string };

export type TwinContent = {
  original: AuthoredPassage;
  reading:
    | { state: "original" }
    | { state: "translated"; passage: AuthoredPassage; originalLabel: string; translationLabel?: string }
    | { state: "pending" | "unavailable"; label: string };
};

function Passage({ text, lang }: AuthoredPassage) {
  return <p className="bb-passage" dir="auto" lang={lang}>{text}</p>;
}

function TwinText({ original, reading }: TwinContent) {
  return <>
    <div className="bb-twin-reading">
      {reading.state === "translated" && reading.translationLabel && <p className="mb-1 text-caption text-muted">{reading.translationLabel}</p>}
      <Passage {...(reading.state === "translated" ? reading.passage : original)} />
    </div>
    {reading.state === "translated" ? <div className="bb-twin-original">
      <p className="mb-1 text-caption text-muted">{reading.originalLabel}</p>
      <Passage {...original} />
    </div> : reading.state !== "original" && <p className="bb-twin-original text-supporting text-muted">{reading.label}</p>}
  </>;
}

export type TwinBubbleProps = TwinContent & {
  author: { name: string; role?: string };
  time: ReactNode;
  outgoing?: boolean;
  correction?: string;
  delivery?: { label: string; state: "queued" | "failed" };
};

export function TwinBubble({ author, time, outgoing, correction, delivery, ...content }: TwinBubbleProps) {
  return (
    <article className="bb-twin-bubble" data-outgoing={outgoing || undefined}>
      <p className="text-supporting text-muted">
        <bdi>{author.name}</bdi>{author.role && <> · {author.role}</>}
        {typeof time === "string" ? time && <> · <bdi className="tabular-nums">{time}</bdi></> : time}
      </p>
      <div className="bb-twin-surface"><TwinText {...content} /></div>
      {(correction || delivery) && <div className="flex flex-wrap gap-2">
        {correction && <Badge label={correction} tone="info" />}
        {delivery && <Badge label={delivery.label} tone={delivery.state === "failed" ? "critical" : "attention"} />}
      </div>}
    </article>
  );
}

export type TwinCardProps = TwinContent & { title: string; footer?: ReactNode };

export function TwinCard({ title, footer, ...content }: TwinCardProps) {
  return <Card title={title} footer={footer}><div className="bb-twin-card"><TwinText {...content} /></div></Card>;
}

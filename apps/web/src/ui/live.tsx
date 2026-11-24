import type { CSSProperties, ReactNode } from "react";
import { Link, type To } from "react-router";
import { Glyph, type GlyphName } from "./glyph";

export type JobLineProps = {
  stages: readonly { id: string; label: string }[];
  currentId: string;
  ariaLabel: string;
  /** Caller-calculated estimate from the current step toward the next one, in [0, 1]. */
  fractionToNext?: number;
  estimateLabel?: string;
  notice?: { kind: "delayed" | "cover" | "cancelled"; label: string };
  quiet?: boolean;
  compact?: boolean;
  labelAll?: boolean;
  surface?: "neutral" | "capsule";
};

export function JobLine({ stages, currentId, ariaLabel, fractionToNext = 0, estimateLabel, notice, quiet, compact, labelAll, surface = "neutral" }: JobLineProps) {
  const current = stages.findIndex((stage) => stage.id === currentId);
  if (!stages.length) return null;
  const last = stages.length - 1;
  const paused = quiet || notice !== undefined;
  const estimate = !paused && estimateLabel && Number.isFinite(fractionToNext) ? Math.min(1, Math.max(0, fractionToNext)) : 0;
  const style = {
    "--bb-stage-count": stages.length,
    "--bb-track-inset": `${50 / stages.length}%`,
    "--bb-track-fill": `${current >= 0 && last > 0 ? 100 * Math.min(last, current + estimate) / last : 0}%`,
  } as CSSProperties;

  return (
    <div className="bb-job-line" data-surface={surface} data-labels={labelAll && !compact ? "all" : undefined}>
      <div className="bb-job-diagram" style={style} data-quiet={paused || undefined} role="img" aria-label={ariaLabel}>
        {last > 0 && <div className="bb-job-track" aria-hidden="true"><span /></div>}
        <ol className="bb-job-stages" aria-hidden="true">
          {stages.map((stage, index) => (
            <li className="bb-job-stage" key={stage.id} data-step={index < current ? "done" : index === current ? "current" : "next"}>
              <span className="bb-job-bead">{index < current && <Glyph name="check" />}</span>
              {!compact && (labelAll || index >= current) && <span className="bb-job-label">{stage.label}</span>}
            </li>
          ))}
        </ol>
      </div>
      {notice ? <p className="bb-job-note" data-notice={notice.kind}>
        <Glyph name={notice.kind === "cancelled" ? "cancel" : notice.kind === "cover" ? "crew" : "clock"} />{notice.label}
      </p> : estimate > 0 && <p className="bb-job-note">{estimateLabel}</p>}
    </div>
  );
}

export type LiveCapsuleProps = {
  to?: To;
  ariaLabel: string;
  source: string;
  sourceGlyph?: GlyphName;
  reference: string;
  state: { kind: "live" | "quiet" | "paused" | "finished"; label: string };
  time?: string;
  clocks?: Omit<TwoClockProps, "size">;
  provenance: string;
  stageLine: Omit<JobLineProps, "surface" | "quiet">;
  size?: "hero" | "card" | "pill";
};

export function LiveCapsule({ to, ariaLabel, source, sourceGlyph = "van", reference, state, time, clocks, provenance, stageLine, size = "hero" }: LiveCapsuleProps) {
  const content = (
      <div className="bb-live-content" aria-hidden={to !== undefined || undefined}>
        {size !== "pill" && <div className="bb-live-line text-supporting text-live-capsule-supporting-text">
          <span className="bb-live-source"><Glyph name={sourceGlyph} /><bdi>{source}</bdi></span>
          <bdi className="tabular-nums">{reference}</bdi>
        </div>}
        <div className="bb-live-line bb-live-title">
          <span className="bb-live-source">
            {size === "pill" && (state.kind === "finished" || state.kind === "paused"
              ? <Glyph name={state.kind === "finished" ? "check" : "pause"} />
              : <span className="bb-live-pip" />)}
            {state.label}
          </span>
          <span className="bb-live-trailing">
            {time && <bdi className="bb-live-time tabular-nums">{time}</bdi>}
            {to !== undefined && <Glyph name="chevron" />}
          </span>
        </div>
        {clocks && <TwoClock {...clocks} size={size === "hero" ? "display" : "label"} />}
        {size !== "pill" && <>
          <JobLine {...stageLine} surface="capsule" quiet={state.kind !== "live"} />
          {provenance && <p className="text-supporting text-live-capsule-supporting-text">{provenance}</p>}
        </>}
      </div>
  );
  return to !== undefined
    ? <Link to={to} aria-label={ariaLabel} className="bb-live-capsule" data-size={size} data-state={state.kind}>{content}</Link>
    : <section className="bb-live-capsule" data-size={size} data-state={state.kind}>{content}</section>;
}

type ClockReading = { value: string; zoneLabel: string; dateTime?: string };

export type TwoClockProps = {
  site: ClockReading;
  /** Include only when enabled and in a different zone; include the date in the value when it differs. */
  viewer?: ClockReading;
  size?: "label" | "display";
};

function ClockValue({ value, dateTime }: ClockReading) {
  return <bdi className="tabular-nums">{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</bdi>;
}

export function TwoClock({ site, viewer, size = "label" }: TwoClockProps) {
  return (
    <span className="bb-clock">
      <span className="bb-clock-site">
        <span className={size === "display" ? "text-display" : "text-label"}><ClockValue {...site} /></span>
        <span className="text-supporting text-muted">{site.zoneLabel}</span>
      </span>
      {viewer && <span className="bb-clock-viewer text-supporting text-muted">
        <ClockValue {...viewer} /> <span>{viewer.zoneLabel}</span>
      </span>}
    </span>
  );
}

const arrivalGlyph: Record<"window" | "on-the-way" | "due" | "no-update", GlyphName> = {
  window: "calendar", "on-the-way": "van", due: "clock", "no-update": "info",
};

export type ArrivalBandProps =
  | { state: keyof typeof arrivalGlyph; label: string; clocks: Omit<TwoClockProps, "size">; provenance?: string; countdown?: string }
  | { state: "arrived"; stamp: StampProps };

export function ArrivalBand(props: ArrivalBandProps) {
  if (props.state === "arrived") return <Stamp {...props.stamp} />;
  const { state, label, clocks, provenance, countdown } = props;
  return (
    <div className="bb-arrival" data-state={state}>
      <p className="flex items-center gap-2 text-label"><Glyph name={arrivalGlyph[state]} />{label}</p>
      <TwoClock {...clocks} size="display" />
      {countdown && <p className="text-supporting tabular-nums"><bdi>{countdown}</bdi></p>}
      {provenance && <p className="text-supporting text-muted">{provenance}</p>}
    </div>
  );
}

const crewGlyph = { confirmed: "check", "on-the-way": "van", "on-site": "pin", hold: "pause", gap: "alert", replaced: "replace" } as const;

export type CrewDotsProps = {
  /** Only confirmed people in the scoped roster; status below applies to the crew, not individuals. */
  people: readonly { id: string; name: string; initials: string; role: string; tone?: "a" | "b" | "c" | "d" }[];
  status: keyof typeof crewGlyph;
  statusLabel: string;
  overflowLabel?: string;
};

export function CrewDots({ people, status, statusLabel, overflowLabel }: CrewDotsProps) {
  const visible = people.slice(0, 3);
  return (
    <div className="bb-crew" data-status={status}>
      <div className="bb-crew-avatars" aria-hidden="true">
        {visible.map(({ id, initials, tone = "a" }) => <span key={id} className="bb-avatar bb-crew-avatar" data-tone={tone}><bdi>{initials}</bdi></span>)}
        {people.length > visible.length && overflowLabel && <span className="bb-avatar bg-subtle"><bdi>{overflowLabel}</bdi></span>}
      </div>
      <div className="min-w-0">
        <p className="bb-crew-status text-label"><Glyph name={crewGlyph[status]} />{statusLabel}</p>
        {people.length > 0 && <ul className="bb-crew-names text-supporting text-muted">
          {people.map(({ id, name, role }) => <li key={id}><bdi>{name}</bdi>{role && <> · {role}</>}</li>)}
        </ul>}
      </div>
    </div>
  );
}

const stampGlyph = { crew: "crew", attendance: "pin", photo: "photo", decision: "decision", system: "info" } as const;

export type StampProps = {
  kind: keyof typeof stampGlyph;
  title: string;
  actor?: { name: string; role: string };
  time: ReactNode;
  dateTime?: string;
  delivery?: { state: "pending" | "rejected"; label: string };
  photo?: { src: string; alt: string };
};

export function Stamp({ kind, title, actor, time, dateTime, delivery, photo }: StampProps) {
  return (
    <article className="bb-stamp" data-delivery={delivery?.state}>
      <span className="bb-stamp-icon"><Glyph name={delivery?.state === "rejected" ? "alert" : stampGlyph[kind]} /></span>
      <div className="min-w-0">
        <p className="text-label">{title}</p>
        {actor && <p className="text-supporting text-muted"><bdi>{actor.name}</bdi>{actor.role && <> · {actor.role}</>}</p>}
        {delivery && <p className={`text-supporting ${delivery.state === "rejected" ? "text-critical-ink" : "text-attention-ink"}`}>{delivery.label}</p>}
        {typeof time === "string" ? <p className="text-supporting text-muted"><ClockValue value={time} dateTime={dateTime} zoneLabel="" /></p> : time}
      </div>
      {photo && <img className="bb-stamp-photo" src={photo.src} alt={photo.alt} loading="lazy" width={64} height={64} />}
    </article>
  );
}

import { useId, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { Glyph, type GlyphName } from "./glyph";

const destinations = ["now", "bookings", "messages", "places", "settings"] as const;
type Destination = (typeof destinations)[number];
const icons: Record<Destination, GlyphName> = { now: "home", bookings: "calendar", messages: "message", places: "pin", settings: "settings" };

type NavItem = { label: string; to: To; unread?: { value: string; label: string } };

export type PortalShellProps = {
  identity: { name: string; initials: string; detail?: string; to?: To };
  accountActions?: ReactNode;
  nav: Record<Destination, NavItem>;
  current?: Destination;
  navLabel: string;
  skipLabel: string;
  children: ReactNode;
};

export function PortalShell({ identity, accountActions, nav, current, navLabel, skipLabel, children }: PortalShellProps) {
  const mainId = useId();
  const person = <>
    <span className="bb-avatar" data-tone="a" aria-hidden="true"><bdi>{identity.initials}</bdi></span>
    <span className="min-w-0">
      <bdi className="block text-label">{identity.name}</bdi>
      {identity.detail && <bdi className="block text-supporting text-muted">{identity.detail}</bdi>}
    </span>
  </>;

  return (
    <div className="bb-portal">
      <a className="bb-skip" href={`#${mainId}`}>{skipLabel}</a>
      <header className="bb-portal-header">
        <div className="bb-portal-header-inner">
          {accountActions ? <details className="relative">
            <summary className="bb-identity cursor-pointer list-none">{person}</summary>
            <div className="absolute start-0 top-full z-20 mt-2 min-w-44 space-y-2 rounded-xl border border-separator bg-surface p-3">
              {identity.to && <Link className="block p-2" to={identity.to}>{nav.settings.label}</Link>}
              {accountActions}
            </div>
          </details> : identity.to ? <Link to={identity.to} className="bb-identity">{person}</Link> : <div className="bb-identity">{person}</div>}
          <nav className="bb-portal-nav" aria-label={navLabel}>
            <ul>
              {destinations.map((destination) => {
                const item = nav[destination];
                return <li key={destination}>
                  <Link to={item.to} aria-current={current === destination ? "page" : undefined}>
                    <Glyph name={icons[destination]} />
                    <span>{item.label}</span>
                    {item.unread && <>
                      <bdi className="bb-nav-count tabular-nums" aria-hidden="true">{item.unread.value}</bdi>
                      <span className="sr-only">{item.unread.label}</span>
                    </>}
                  </Link>
                </li>;
              })}
            </ul>
          </nav>
        </div>
      </header>
      <main id={mainId} tabIndex={-1} className="bb-portal-main">{children}</main>
    </div>
  );
}

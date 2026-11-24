import { useFormat } from "../../i18n";

export function usePlaceLocationLabel() {
  const format = useFormat();
  return (area: string | null, zone: string | null, now: number) => {
    const clock = zone ? format.siteTime(now, zone) : null;
    const zoneName = clock?.kind === "available" ? format.zoneLabel(zone, clock.site) : null;
    return [area, zoneName].filter(Boolean).join(" · ");
  };
}

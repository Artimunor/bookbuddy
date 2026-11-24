import { registerLinkResolver } from "../links";
import { sessionBookingKind, sessionBookingValue } from "./booking";
import { providerSessionValue } from "./hosting";
import { createSessionsBookingRoutes } from "./routes.booking";
import { sessionsHostingRoutes } from "./routes.hosting";

export { sessionBookingSyncProjection } from "./booking";
export const sessionsRoutes = createSessionsBookingRoutes(providerSessionValue);
sessionsRoutes.route("/", sessionsHostingRoutes);

registerLinkResolver(sessionBookingKind, {
  targetKind: sessionBookingKind,
  project: (resource, scope) => `SELECT json_object('kind', '${sessionBookingKind}', 'booking', json(visible.booking))
    FROM (SELECT ${sessionBookingValue(resource, scope)} AS booking) visible WHERE visible.booking IS NOT NULL`,
});

import { enabledLocales } from "@bookbuddy/i18n/locales";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { publicLocaleRouteId, routes } from "./routes";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing web root");

const prerenderedLocale = root.dataset.prerenderedLocale;
if (prerenderedLocale !== undefined) {
  const locale = enabledLocales.find(({ tag }) => tag === prerenderedLocale);
  if (!locale) throw new Error("Unknown prerendered locale");

  const router = createBrowserRouter(routes, {
    hydrationData: { loaderData: { [publicLocaleRouteId(locale.tag)]: locale } },
  });
  hydrateRoot(root, <RouterProvider router={router} />);
} else {
  const router = createBrowserRouter(routes);
  createRoot(root).render(<RouterProvider router={router} />);
}

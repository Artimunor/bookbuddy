import { portalDocumentPath, redirectPublicEntry } from "../src/entry/host";

interface Binding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  API: Binding;
  ASSETS: Binding;
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }

    const redirect = redirectPublicEntry(
      request.method, url, request.headers.get("Cookie"), request.headers.get("Accept-Language"),
    );
    if (redirect) return redirect;

    if ((request.method === "GET" || request.method === "HEAD") && portalDocumentPath.test(url.pathname)) {
      // The assets binding bypasses this Worker; `/` is the canonical path for `/index.html`.
      url.pathname = "/";
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};

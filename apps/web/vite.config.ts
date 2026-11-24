import { enabledLocales } from "@bookbuddy/i18n/locales";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";
import { portalDocumentPath, redirectPublicEntry } from "./src/entry/host";
import { localizedPath, publicPaths } from "./src/entry/public-paths";

const publicDocuments = new Map(enabledLocales.flatMap(({ tag }) =>
  publicPaths.map((path) => {
    const canonical = localizedPath(tag, path);
    return [canonical.replace(/\/$/, ""), canonical] as const;
  }),
));

function documents(serveSource: boolean): Connect.NextHandleFunction {
  return (request, response, next) => {
    const method = request.method;
    if (method !== "GET" && method !== "HEAD") return next();

    const url = new URL(request.url ?? "/", "http://localhost");
    const redirect = redirectPublicEntry(method, url, request.headers.cookie, request.headers["accept-language"]);
    if (redirect) {
      response.statusCode = redirect.status;
      redirect.headers.forEach((value, name) => response.setHeader(name, value));
      response.end();
      return;
    }

    if (portalDocumentPath.test(url.pathname)) {
      request.url = `/index.html${url.search}`;
    } else {
      const publicDocument = publicDocuments.get(url.pathname.replace(/\/$/, ""));
      if (publicDocument) request.url = `${serveSource ? "/index.html" : publicDocument}${url.search}`;
    }
    next();
  };
}

const webDocuments: Plugin = {
  name: "bookbuddy-documents",
  configureServer(server) {
    server.middlewares.use(documents(true));
  },
  configurePreviewServer(server) {
    server.middlewares.use(documents(false));
  },
};

export default defineConfig({
  appType: "mpa",
  plugins: [webDocuments, react(), tailwindcss()],
  resolve: {
    alias: [{
      find: /^@formatjs\/icu-messageformat-parser$/,
      replacement: "@formatjs/icu-messageformat-parser/no-parser.js",
    }],
  },
  server: {
    proxy: {
      "^/api(?:/|$)": { target: "http://127.0.0.1:8787", ws: true },
    },
  },
});

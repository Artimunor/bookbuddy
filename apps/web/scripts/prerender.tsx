import { enabledLocales } from "@bookbuddy/i18n/locales";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { localizedPath, publicPaths } from "../src/entry/public-paths";
import { routes } from "../src/entry/routes";

const dist = new URL("../dist/", import.meta.url);
const template = await readFile(new URL("index.html", dist), "utf8");
const documentTag = '<html lang="en" dir="ltr">';
const mount = '<div id="root"></div>';
if (!template.includes(documentTag) || !template.includes(mount)) {
  throw new Error("The Vite HTML shell is missing its prerender markers");
}

const { dataRoutes, query } = createStaticHandler(routes);
const outputDirectories = new Set<string>();
for (const { tag, dir } of enabledLocales) {
  const documentShell = template.replace(documentTag, `<html lang="${tag}" dir="${dir}">`);
  for (const path of publicPaths) {
    const pathname = localizedPath(tag, path);
    const context = await query(new Request(`https://prerender.invalid${pathname}`));
    if (context instanceof Response || context.statusCode !== 200) {
      throw new Error(`Cannot prerender ${pathname}`);
    }

    const router = createStaticRouter(dataRoutes, context);
    const body = renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);
    const html = documentShell.replace(mount, () =>
      `<div id="root" data-prerendered-locale="${tag}">${body}</div>`);
    const output = pathname.slice(1) + (path === "/" ? "index.html" : ".html");
    const page = new URL(output, dist);
    const directory = new URL(".", page);
    if (!outputDirectories.has(directory.href)) {
      await mkdir(directory, { recursive: true });
      outputDirectories.add(directory.href);
    }
    await writeFile(page, html);
    console.log(`Prerendered ${output}`);
  }
}

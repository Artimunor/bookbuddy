# BookBuddy UI catalogs

Use `createTranslator(surface, locale).t("literal.key", values)` for bundled UI copy. English is the source and fallback; `pt-PT` is European Portuguese. `MessageKey<Surface>` includes the shared keys plus the requested surface's keys. TypeScript checks each message's ICU values.

In production apps, import the bound factory so the bundle includes only its surface and `shared`:

```ts
import { createMobileTranslator } from "@bookbuddy/i18n/mobile";

const { t } = createMobileTranslator("pt-PT");
t("shared.status.lastConfirmed", { time: "14:35" });
```

The web and Worker entries are `@bookbuddy/i18n/web` (`createWebTranslator`) and `@bookbuddy/i18n/push` (`createPushTranslator`). The root `@bookbuddy/i18n` entry is for consumers that need to select from all surfaces. Development and tests can import `createTranslator` from `@bookbuddy/i18n/dev` to try `en-XA` (approximately 40% wider) or `ar-XB` (use `directionOf` to set the layout to RTL). Do not import that entry in production code.

## Contribute copy

Each feature slice owns `contributions/<sliceId>.json`. Use an array of entries like this:

```json
[
  {
    "surface": "mobile",
    "key": "mobile.place.welcome",
    "messages": { "en": "Welcome, {name}.", "pt-PT": "Olá, {name}." },
    "context": "Greeting after adding a place. {name} is the customer's given name."
  }
]
```

Start keys with `shared.`, `mobile.`, `web.`, or `push.` to match the surface. Choose a feature namespace; for web, distinguish `web.public.` from `web.portal.`. Supply real translations and explain where the copy appears, what its placeholders mean and any length constraints. Keep the same ICU arguments, `select` branches and exact-number plural branches; plural categories may vary by language. `other` is the fallback for a `select`, including unspecified gender.

Do not edit canonical catalogs or generated types in parallel slices. The integrator runs `bun run --cwd packages/i18n merge` from the repo root. It validates all pending files, writes sorted canonical catalogs and context, regenerates ASTs and types, then deletes the merged files. Commit those changes together. Use `bun run i18n:build` to regenerate and `bun run i18n:check` to check parity, ICU, generated output and literal `t()` calls under `apps/`. The usage check recognizes pending keys before merge; the runtime and types only include merged keys. Unused keys warn without failing.

## Bundle configuration

Alias the exact runtime specifier `@formatjs/icu-messageformat-parser` to `@formatjs/icu-messageformat-parser/no-parser.js` in Vite `resolve.alias`, Metro `resolver.resolveRequest`, and Wrangler `alias`. Do not apply the alias to the Bun catalog build: it needs the real parser. Runtime messages and their English fallbacks are already compiled and never require a fetch.

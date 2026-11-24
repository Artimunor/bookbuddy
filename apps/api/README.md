# Local construction demo

Copy `.dev.vars.example` to `.dev.vars` in this directory. From the repository root, run:

```sh
SEED_EMAIL_DOMAIN=bookbuddy.test bun scripts/seed.ts --scenario construction --until quote-issued --reset
```

The command above applies migrations and uses only local Wrangler state under `apps/api/.wrangler/state`; `--reset` deletes its D1 database files, not other local resources. Without `--reset`, seed only into a fresh database. It prints the synthetic account emails and roles. Available checkpoints are `request-sent`, `assessment-done`, `quote-issued`, `quote-approved`, `visit-booked`, `crew-confirmed`, `dropout`, `cover-offered`, `cover-accepted`, `cover-confirmed`, `on-the-way`, `checked-in`, `briefed`, `work-started`, `work-finished`, `checked-out`, `completion-submitted`, `signed-off`, `bill-issued`, and `paid-recorded`. The snapshot uses the actual November 2026 story timestamps; seeded quotes expire on 30 November 2026.

Wrangler's `dev` proxy requires Node to forward requests to Miniflare. Under Bun it returns HTTP 503 before the Worker route runs. The Wrangler migration and seed commands above still work under Bun.

## Bun-only portal demo

With `.dev.vars` copied from the example, run from the repository root:

```sh
db=apps/api/.wrangler/bun-dev/bookbuddy.sqlite
SEED_EMAIL_DOMAIN=$(awk -F= '/^# SEED_EMAIL_DOMAIN=/{print $2}' apps/api/.dev.vars.example) \
  bun scripts/seed.ts --scenario construction --until quote-issued --reset --target bun-sqlite "$db"
bun apps/api/dev/server.ts "$db"
```

Run `bun run dev:web` in another terminal. Open `/portal/sign-in` on the Vite origin and use the synthetic customer printed by the seed command. The example enables `OTP_MAIL_DEV`, `OTP_DEV_LOG_CODE`, and a synthetic fixture code; the API terminal logs `bookbuddy.mail.fixture_code` for that mailbox. Keep the same `OTP_HMAC_KEY` when seeding and signing in. Do not set these fixture flags or deploy the example secrets in production. The Worker refuses mail delivery when any fixture flag is present.

The API listens only on loopback and uses the real Hono routes, migrations, SQL and outbox consumer. It does not emulate Cloudflare queue delivery, live updates or evidence storage, and it does not call external mail or push providers. The SQLite file persists between runs and is separate from Wrangler's state. Stop the API before replacing that file with `--reset`.

To issue a first quote through the app, seed through `assessment-done` instead. It leaves BB-1042 assigned to Mateo with a finished assessment and no quote. `EXPO_PUBLIC_BOOKBUDDY_LOCAL_WEB=1 bun run export:preview` exports the real Expo routes rather than the screen catalog. Serve that export on a loopback origin with a same-origin `/api` proxy to the Bun API, preserving `Host` and `Origin`. This export uses the API’s HttpOnly session cookie; the native bearer flow and ordinary screen-catalog export are unchanged.

## Production live upgrades

Before exposing `/api/v1/live`, add a Cloudflare rate-limiting rule for `GET` requests whose URI path is exactly `/api/v1/live`. Count by source IP, not topic or credential. Start at 60 requests per IP per minute with a one-minute block; check the limit against pilot traffic behind shared networks. Apply the rule on every public hostname that routes to the Worker. The Worker rejects malformed credentials before routing, but only the edge rule limits requests carrying well-formed, unknown credentials.

The pilot uses one hibernating Durable Object. It tags sockets by topic for invalidations and by session for sign-out. If measured pilot traffic outgrows that object, shard by topic and account for cross-shard session closure before switching routing.

# Local construction demo

Copy `.dev.vars.example` to `.dev.vars` in this directory. From the repository root, run:

```sh
SEED_EMAIL_DOMAIN=bookbuddy.test bun scripts/seed.ts --scenario construction --until quote-issued --reset
```

The script applies migrations and uses only the local Wrangler state under `apps/api/.wrangler/state`; `--reset` deletes its D1 database files, not other local resources. Without `--reset`, seed only into a fresh database. It prints the synthetic account emails and roles. Available checkpoints are `request-sent`, `quote-issued`, `quote-approved`, `visit-booked`, `crew-confirmed`, `dropout`, `cover-offered`, `cover-accepted`, `cover-confirmed`, `on-the-way`, `checked-in`, `briefed`, `work-started`, `work-finished`, `checked-out`, `completion-submitted`, `signed-off`, `bill-issued`, and `paid-recorded`. The snapshot uses the actual November 2026 story timestamps; quote expiry is 30 November 2026, so the issued quote is not actionable after that instant without a separate local scenario clock.

Start the local API with `bun run dev:api` from the root. The example enables `OTP_MAIL_DEV=true`, `OTP_DEV_LOG_CODE=true`, and the six-digit `OTP_DEV_TEST_CODE=123456`. For a local request to localhost and a synthetic `.test` or `.invalid` mailbox, the first code is the configured fixture code; reissues advance it and the local mail effect logs `bookbuddy.mail.fixture_code`. These flags are for isolated development only, not production. Normal generated codes are never logged. Keep the same `OTP_HMAC_KEY` in `.dev.vars` for seeding and API sign-in, and do not deploy the example secrets.

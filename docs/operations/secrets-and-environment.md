# Worker secrets and environment

## Production configuration

Before the first deploy, provision D1 database `bookbuddy-db`, private R2 bucket `bookbuddy-evidence`, and queue `bookbuddy-effects` in the BookBuddy Cloudflare account. The API deploy applies the existing D1 migrations and creates the `LiveTopic` Durable Object namespace through its Worker migration.

In `apps/api/wrangler.jsonc`, fill in the account and D1 IDs, then set the production vars:

| Var | Value |
|---|---|
| `PUBLIC_APP_ORIGIN` | The public HTTPS origin of the portal. Invitation links use this origin. |
| `R2_ACCOUNT_ID` | The Cloudflare account that owns `bookbuddy-evidence`; use the pinned account ID when it owns the bucket. |
| `R2_EVIDENCE_BUCKET` | `bookbuddy-evidence`, matching the `EVIDENCE` binding. |
| `MAIL_FROM` | The sender's plain email address on the onboarded sending subdomain. |

## Cloudflare Email Sending

1. Enable **Workers Paid** on the BookBuddy account. Cloudflare **Email Sending** on this plan can reach arbitrary recipients; verified destinations alone cannot support sign-in and invitations.
2. In **Email Service → Email Sending → Onboard Domain**, onboard a dedicated sending subdomain and verify the DNS records Cloudflare supplies for SPF, DKIM, DMARC and bounce handling. Do not enable **Email Routing** or change the existing inbound MX records.
3. Set `MAIL_FROM` in `apps/api/wrangler.jsonc` to a sender on the verified sending subdomain. Keep the `SEND_EMAIL` binding unrestricted by recipient; if a sender allowlist is configured, include `MAIL_FROM`. No mail API token is needed.

The Worker refuses OTP and email invitation commands if the binding or sender is missing. A successful send records Cloudflare acceptance, not inbox delivery. Only definite quota refusals are retried: up to three attempts total, at least one minute apart and before the intent expires. Ambiguous outcomes are not sent again.

## API Worker secrets

Set up the [BookBuddy Wrangler profile](cloudflare-auth.md) first. From `apps/api`, run the applicable commands and enter each value at Wrangler's prompt. Do not put values in command arguments, `wrangler.jsonc`, or a tracked file. Never reuse the local fixture keys.

```sh
bunx --no-install wrangler secret put OTP_HMAC_KEY
bunx --no-install wrangler secret put EFFECTS_ENCRYPTION_KEY
bunx --no-install wrangler secret put SYNC_CURSOR_HMAC_KEY
bunx --no-install wrangler secret put R2_ACCESS_KEY_ID
bunx --no-install wrangler secret put R2_SECRET_ACCESS_KEY
```

Set these only for the corresponding enabled features. For `CASE_STEWARD_ACCOUNT_ID`, verify the production case steward independently; do not copy the fixture account ID.

```sh
bunx --no-install wrangler secret put CASE_STEWARD_ACCOUNT_ID
bunx --no-install wrangler secret put EXPO_ACCESS_TOKEN
bunx --no-install wrangler secret put GOOGLE_TRANSLATION_CREDENTIAL
```

## Local overrides

Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`. Wrangler loads this ignored file for local development; local D1, R2, and queue emulation do not require a Cloudflare login or real IDs. Add any other local Worker var overrides there, not in the production config.

`OTP_MAIL_DEV`, `OTP_DEV_LOG_CODE`, and `OTP_DEV_TEST_CODE` are local fixtures, not production secrets. Do not set them in production, even to false: their presence disables production mail delivery.

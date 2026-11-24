# Cloudflare account and Wrangler profile

BookBuddy pins its Cloudflare account in `apps/api/wrangler.jsonc` and `apps/web/wrangler.jsonc`. For initial setup, replace `<CLOUDFLARE_ACCOUNT_ID>` in both files with the BookBuddy account ID. Replace `<D1_DATABASE_ID>` in the API config with the ID of `bookbuddy-db`. See [Secrets and environment](secrets-and-environment.md) for the remaining production values and resource names.

`bun run check:wrangler` checks that the Workers share an account ID and compatibility date. It accepts placeholders for local work. `bun run check:wrangler --deploy` rejects unresolved placeholders before any remote migration or deploy.

## Bind the profile once per machine

Install the project's dependencies and have Node.js 22.12 or later on `PATH`; Wrangler uses Node for deployment and for the local dev proxy. Wrangler 4.167.0 supports named OAuth profiles. From the repository root, put the API workspace's pinned Wrangler on `PATH` and run:

```sh
export PATH="$PWD/apps/api/node_modules/.bin:$PATH"
bunx wrangler auth create bookbuddy
bunx wrangler auth activate bookbuddy .
```

The first command opens a browser for OAuth consent. Sign in with the Cloudflare user that has access to the BookBuddy account. The second command binds this checkout to the profile, and Wrangler inherits the binding in its app directories.

Do not put `CLOUDFLARE_API_TOKEN` in `.env` or export it in the shell: an API token overrides the profile. Do not set `CLOUDFLARE_ACCOUNT_ID`; the Worker configs select the account directly.

## Deploy the API

From the repository root:

```sh
bun run --cwd apps/api deploy
```

The script checks both Worker configs, warms the profile, applies remote D1 migrations, and deploys `bookbuddy-api`. To apply only the migrations, run `bun run --cwd apps/api db:migrate:remote`. The warm-up waits three seconds only if Wrangler refreshes the token; D1 can briefly reject a newly refreshed token with HTTP 403 (code 7403). If authentication fails, the script stops before migrating.

For the portal deployment, see [Hosting on Cloudflare](../../apps/web/README.md#hosting-on-cloudflare).

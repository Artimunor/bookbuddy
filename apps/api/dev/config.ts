import { parseEnv } from "node:util";

export const hostname = "127.0.0.1";
export const port = 8787;
const allowedHosts = /^(?:127\.0\.0\.1|localhost):(?:5173|8787)$/;

export async function fixtureBindings() {
  const vars = parseEnv(await Bun.file(new URL("../.dev.vars", import.meta.url)).text());
  if (vars.OTP_MAIL_DEV !== "true") throw new Error("The Bun demo API requires OTP_MAIL_DEV=true in apps/api/.dev.vars");
  // Do not import deployment mail, public link, or push provider configuration.
  return {
    OTP_MAIL_DEV: vars.OTP_MAIL_DEV,
    OTP_HMAC_KEY: vars.OTP_HMAC_KEY,
    EFFECTS_ENCRYPTION_KEY: vars.EFFECTS_ENCRYPTION_KEY,
    SYNC_CURSOR_HMAC_KEY: vars.SYNC_CURSOR_HMAC_KEY,
    OTP_DEV_LOG_CODE: vars.OTP_DEV_LOG_CODE,
    OTP_DEV_TEST_CODE: vars.OTP_DEV_TEST_CODE,
  };
}

export function localRequest(request: Request): Request | null {
  // Vite preserves Host on /api. Keep that same origin for the real API's
  // cookie and CSRF checks, and reject non-loopback hosts.
  const host = request.headers.get("Host");
  if (!host || !allowedHosts.test(host)) return null;
  const url = new URL(request.url);
  if (url.host === host) return request;
  url.host = host;
  return new Request(url, request);
}

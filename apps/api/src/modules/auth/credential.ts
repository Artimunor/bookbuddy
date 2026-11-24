import { authTokenPattern } from "@bookbuddy/api-contract";

export const sessionCookieName = "__Host-bookbuddy_session";

export function isTrustedOrigin(request: Request): boolean {
  const { origin } = new URL(request.url);
  return request.headers.get("Origin") === origin;
}

// The ingress and the Durable Object share the exact transport/shape checks.
export function requestSessionCredential(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  const write = request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
  const requiresOrigin = write || request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  if (requiresOrigin && (authorization === null || request.headers.has("Origin")) && !isTrustedOrigin(request)) return null;

  let credential: string | undefined;
  if (authorization !== null) {
    credential = /^Bearer ([^ ]+)$/i.exec(authorization)?.[1];
  } else {
    for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
      const cookie = part.trim();
      if (!cookie.startsWith(`${sessionCookieName}=`)) continue;
      if (credential !== undefined) return null;
      credential = cookie.slice(sessionCookieName.length + 1);
    }
  }
  return credential && authTokenPattern.test(credential) ? credential : null;
}

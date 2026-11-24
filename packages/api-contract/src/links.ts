import { z } from "zod";
import { idSchemaFor } from "./common";

export const opaqueLinkRoute = "/l/:token";
export const linkTokenSchema = idSchemaFor<"link_token">();
export type LinkToken = z.infer<typeof linkTokenSchema>;

const httpsUrlSchema = z.url({ protocol: /^https$/, normalize: true });
const httpsOriginSchema = z.string().regex(/^https:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/)
  .refine((origin) => {
    const url = httpsUrlSchema.safeParse(origin);
    return url.success && url.data === `${origin}/`;
  });

export const opaqueLinkPathSchema = z.string().regex(/^\/l\/[A-Za-z0-9_-]{1,256}$/)
  .transform((path) => path as `/l/${string}`);
export type OpaqueLinkPath = z.infer<typeof opaqueLinkPathSchema>;

export const opaqueLinkUrlSchema = z.string().refine((href) => {
  const pathIndex = href.indexOf("/", "https://".length);
  return pathIndex !== -1 && httpsOriginSchema.safeParse(href.slice(0, pathIndex)).success
    && opaqueLinkPathSchema.safeParse(href.slice(pathIndex)).success;
}).transform((href) => href as `https://${string}${OpaqueLinkPath}`);
export type OpaqueLinkUrl = z.infer<typeof opaqueLinkUrlSchema>;

export function createOpaqueLink(origin: string, token: string): OpaqueLinkUrl {
  return `${httpsOriginSchema.parse(origin)}/l/${linkTokenSchema.parse(token)}` as OpaqueLinkUrl;
}

// Incoming HTTPS destinations must match the app's configured origin, not just the public shape.
export function parseOpaqueLink(origin: string, href: string): LinkToken | null {
  const prefix = `${httpsOriginSchema.parse(origin)}/l/`;
  if (!href.startsWith(prefix)) return null;
  const token = linkTokenSchema.safeParse(href.slice(prefix.length));
  return token.success ? token.data : null;
}

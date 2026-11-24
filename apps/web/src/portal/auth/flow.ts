import type { EmailAttempt, RouteRequest, emailStartRoute } from "@bookbuddy/api-contract";

export type Device = Omit<RouteRequest<typeof emailStartRoute.input>["body"], "attemptId">;
type Challenge = { device: Device; attempt: EmailAttempt; offset: number };

export const authDraft: { challenge: Challenge | null; email: string } = { challenge: null, email: "" };

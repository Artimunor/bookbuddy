import { localMailDelivery } from "../config";
import type { AuthBindings } from "../config";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  // Only the isolated local fixture supplies a code here, never generated OTPs.
  readonly syntheticOtp?: string;
}
export type MailResult = { state: "delivered"; providerRef?: string } | { state: "failed" | "retryable" | "unknown" };
export interface MailDelivery {
  send(message: MailMessage): Promise<MailResult>;
}

function configuredSender(env: AuthBindings): string | undefined {
  // Deployment vars never select the in-process fixture. A stray fixture flag disables real sending.
  if (env.OTP_MAIL_DEV !== undefined || env.OTP_DEV_LOG_CODE !== undefined || env.OTP_DEV_TEST_CODE !== undefined) return;
  const from = env.MAIL_FROM?.trim();
  if (typeof env.SEND_EMAIL?.send === "function" && from && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(from)) return from;
}

export function canSendMail(env: AuthBindings): boolean {
  return !!env[localMailDelivery] || configuredSender(env) !== undefined;
}

export function isSyntheticMailbox(email: string): boolean {
  return /@(?:[a-z0-9-]+\.)*(?:test|invalid)$/.test(email);
}

export function createMailDelivery(env: AuthBindings): MailDelivery | null {
  const fixture = env[localMailDelivery];
  if (fixture) return fixture;
  const email = configuredSender(env), binding = env.SEND_EMAIL;
  if (!email || !binding) return null;
  const from = { name: "BookBuddy", email };
  return { async send({ to, subject, text }) {
    try {
      const result = await binding.send({ from, to, subject, text });
      return typeof result?.messageId === "string" && result.messageId
        ? { state: "delivered", providerRef: result.messageId }
        : { state: "delivered" };
    } catch (error) {
      // Only definite provider refusals are safe to classify. Never log the error or message.
      switch (error instanceof Error && "code" in error ? error.code : undefined) {
        case "E_RATE_LIMIT_EXCEEDED":
        case "E_DAILY_LIMIT_EXCEEDED":
          return { state: "retryable" };
        case "E_SENDER_DOMAIN_NOT_AVAILABLE":
        case "E_SENDER_NOT_VERIFIED":
        case "E_RECIPIENT_SUPPRESSED":
        case "E_HEADER_NOT_ALLOWED":
        case "E_HEADER_USE_API_FIELD":
        case "E_TOO_MANY_RECIPIENTS":
          return { state: "failed" };
        default:
          return { state: "unknown" };
      }
    }
  } };
}

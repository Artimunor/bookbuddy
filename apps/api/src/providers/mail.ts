import type { AuthBindings } from "../config";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  // Only the isolated local fixture supplies a code here, never generated OTPs.
  readonly syntheticOtp?: string;
}
export type MailResult = "delivered" | "failed" | "unknown";
export interface MailDelivery {
  send(batch: readonly MailMessage[]): Promise<readonly MailResult[]>;
}

type MailFetch = (url: string, request: RequestInit) => Promise<Response>;

function postmarkConfig(env: AuthBindings) {
  const sender = env.POSTMARK_SENDER?.trim();
  const token = env.POSTMARK_SERVER_TOKEN?.trim();
  if (!sender || !token) return null;
  try {
    const url = new URL(env.POSTMARK_ORIGIN ?? "https://api.postmarkapp.com");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return { url: `${url.origin}/email/batch`, sender, token };
  } catch {
    return null;
  }
}

export function isSyntheticMailbox(email: string): boolean {
  return /@(?:[a-z0-9-]+\.)*(?:test|invalid)$/.test(email);
}

export function createMailDelivery(env: AuthBindings, transport: MailFetch = fetch): MailDelivery | null {
  if (env.OTP_MAIL_DEV === "true") {
    return { async send(batch) {
      for (const message of batch) {
        if (env.OTP_DEV_LOG_CODE === "true" && message.syntheticOtp && isSyntheticMailbox(message.to)) {
          console.info("bookbuddy.mail.fixture_code", message.syntheticOtp);
        } else {
          console.info("bookbuddy.mail.dev_delivery");
        }
      }
      return batch.map(() => "delivered");
    } };
  }
  const config = postmarkConfig(env);
  if (!config) return null;
  return { async send(batch) {
    if (batch.length === 0) return [];
    try {
      const response = await transport(config.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json", Accept: "application/json",
          "X-Postmark-Server-Token": config.token,
        },
        body: JSON.stringify(batch.map(({ to, subject, text }) => ({ From: config.sender, To: to, Subject: subject, TextBody: text }))),
      });
      if (!response.ok) {
        const outcome: MailResult = response.status >= 500 ? "unknown" : "failed";
        return batch.map(() => outcome);
      }
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length !== batch.length) return batch.map(() => "unknown");
      return rows.map((row: unknown): MailResult => {
        const code = row && typeof row === "object" && "ErrorCode" in row ? row.ErrorCode : undefined;
        return typeof code !== "number" ? "unknown" : code === 0 ? "delivered" : "failed";
      });
    } catch {
      // An ambiguous HTTP/transport outcome must not be automatically sent again.
      return batch.map(() => "unknown");
    }
  } };
}

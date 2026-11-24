import type { MailDelivery } from "./providers/mail";

export const API_BASE_PATH = "/api/v1";
export const PRIVATE_CACHE_CONTROL = "private, no-store";

// Only the in-process Bun demo can supply this; Wrangler bindings have string keys.
export const localMailDelivery = Symbol("localMailDelivery");

// Deployment secrets have no default values. OTP is unavailable when its keys are missing.
export interface AuthBindings {
  OTP_HMAC_KEY?: string;
  EFFECTS_ENCRYPTION_KEY?: string;
  SEND_EMAIL?: SendEmail;
  MAIL_FROM?: string;
  [localMailDelivery]?: MailDelivery;
  OTP_MAIL_DEV?: string;
  OTP_DEV_LOG_CODE?: string;
  OTP_DEV_TEST_CODE?: string;
}

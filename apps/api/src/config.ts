export const API_BASE_PATH = "/api/v1";
export const PRIVATE_CACHE_CONTROL = "private, no-store";

// Deployment secrets have no default values. OTP is unavailable when its keys are missing.
export interface AuthBindings {
  OTP_HMAC_KEY?: string;
  EFFECTS_ENCRYPTION_KEY?: string;
  POSTMARK_ORIGIN?: string;
  POSTMARK_SENDER?: string;
  POSTMARK_SERVER_TOKEN?: string;
  OTP_MAIL_DEV?: string;
  OTP_DEV_LOG_CODE?: string;
  OTP_DEV_TEST_CODE?: string;
}

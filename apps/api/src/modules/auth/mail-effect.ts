import type { EffectHandler } from "../../effects/index";
import { isSyntheticMailbox } from "../../providers/mail";
import { openDelivery } from "./crypto";

export const otpEmailEffectKind = "otp_email";

interface OtpMessage {
  email: string;
  code: string;
  synthetic: boolean;
  portuguese: boolean;
}

export function otpMessage(email: string, code: string, synthetic: boolean, language: string | undefined): string {
  return JSON.stringify({ email, code, synthetic, portuguese: /^pt(?:-|$)/i.test(language?.split(",", 1)[0]?.trim() ?? "") });
}

function isOtpMessage(value: unknown): value is OtpMessage {
  if (!value || typeof value !== "object") return false;
  const { email, code, synthetic, portuguese } = value as Partial<OtpMessage>;
  return typeof email === "string" && typeof code === "string" && /^\d{6}$/.test(code)
    && typeof synthetic === "boolean" && typeof portuguese === "boolean";
}

// The prefix (43-character keyed attempt ID + '.' + 43-character command proof)
// survives settlement for idempotency; only the short-lived ciphertext is scrubbed.
export const otpEmailEffect: EffectHandler = {
  kind: otpEmailEffectKind,
  eligible: `EXISTS (SELECT 1 FROM otp_attempts a WHERE a.id = substr(e.resource_ref, 1, 43)
    AND a.state = 'pending' AND e.dedupe_key = 'otp_email:' || a.id || ':' || a.generation)`,
  scrub: "substr(resource_ref, 1, 87)",
  async prepareMail(key, { id, resource_ref }) {
    const value = await openDelivery(key, id, resource_ref.slice(88));
    if (!isOtpMessage(value)) return null;
    return {
      to: value.email,
      subject: value.portuguese ? "Código de acesso BookBuddy" : "BookBuddy sign-in code",
      text: value.portuguese ? `O seu código é ${value.code}. É válido durante 10 minutos após o pedido.`
        : `Your code is ${value.code}. It is valid for 10 minutes after you requested it.`,
      ...(value.synthetic && isSyntheticMailbox(value.email) ? { syntheticOtp: value.code } : {}),
    };
  },
};

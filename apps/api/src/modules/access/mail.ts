import { createOpaqueLink } from "@bookbuddy/api-contract";
import type { Bindings } from "../../bindings";
import type { EffectHandler } from "../../effects/index";
import type { MailMessage } from "../../providers/mail";
import { loadDeliveryKey, loadOtpKey, openDelivery, randomToken, sealDelivery } from "../auth/crypto";
import { hashSessionCredential } from "../auth/session";

export const invitationMailKind = "invitation_email";

export interface InvitationLink {
  id: string;
  effectId: string;
  tokenHash: string;
  sealedLink: string;
}

export async function invitationMailKeys(env: Bindings) {
  try {
    createOpaqueLink(env.PUBLIC_APP_ORIGIN ?? "", "check");
  } catch {
    return null;
  }
  const [lookup, encryption] = await Promise.all([loadOtpKey(env.OTP_HMAC_KEY), loadDeliveryKey(env.EFFECTS_ENCRYPTION_KEY)]);
  return lookup && encryption ? { lookup, encryption, origin: env.PUBLIC_APP_ORIGIN! } : null;
}

export async function prepareInvitationLink(encryption: CryptoKey, origin: string, id: string): Promise<InvitationLink> {
  const effectId = crypto.randomUUID(), token = randomToken();
  const [tokenHash, sealedLink] = await Promise.all([
    hashSessionCredential(token), sealDelivery(encryption, effectId, JSON.stringify(createOpaqueLink(origin, token))),
  ]);
  return { id, effectId, tokenHash, sealedLink };
}

const addressBinding = (key: string) => `invitation-address:${key}`;
export const sealInviteEmail = (encryption: CryptoKey, key: string, email: string) =>
  sealDelivery(encryption, addressBinding(key), JSON.stringify(email));

export async function openInviteEmail(encryption: CryptoKey, key: string, sealed: string): Promise<string> {
  const email = await openDelivery(encryption, addressBinding(key), sealed);
  if (typeof email !== "string") throw new TypeError("Invalid encrypted invitation address");
  return email;
}

export const invitationMailEffect: EffectHandler = {
  kind: invitationMailKind,
  eligible: `EXISTS (SELECT 1 FROM invitations i
    WHERE i.id = substr(e.resource_ref, 1, instr(e.resource_ref, '|') - 1) AND i.state = 'pending')`,
  scrub: "substr(resource_ref, 1, instr(resource_ref, '|') - 1)",
  async prepareMail(key, { id, resource_ref }): Promise<MailMessage | null> {
    try {
      const [, recipientKey, sealedEmail, sealedLink, locale] = resource_ref.split("|");
      if (!recipientKey || !sealedEmail || !sealedLink) return null;
      const [to, link] = await Promise.all([openInviteEmail(key, recipientKey, sealedEmail), openDelivery(key, id, sealedLink)]);
      if (typeof link !== "string") return null;
      const portuguese = /^pt(?:-|$)/i.test(locale ?? "");
      return {
        to,
        subject: portuguese ? "Convite BookBuddy" : "BookBuddy invitation",
        text: portuguese ? `Tem um convite no BookBuddy. Abra-o com esta conta de email: ${link}`
          : `You have a BookBuddy invitation. Open it with this email account: ${link}`,
      };
    } catch {
      return null;
    }
  },
};

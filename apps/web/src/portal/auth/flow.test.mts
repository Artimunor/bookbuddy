import { expect, test } from "bun:test";
import { accountSettingsPatchSchema } from "@bookbuddy/api-contract";
import { createWebTranslator } from "@bookbuddy/i18n/web";
import { initialSetupClocks } from "./flow";

test.each([["Europe/Madrid", false], ["Europe/Lisbon", true]] as const)(
  "setup keeps time-zone sharing off independently of the local second clock (%s)", (zone, twoClock) => {
    const clocks = initialSetupClocks(zone);
    expect(accountSettingsPatchSchema.parse({ ...clocks, displayZone: twoClock ? zone : null }))
      .toEqual({ twoClock, shareDisplayZone: false, displayZone: twoClock ? zone : null });
  },
);

test("time-zone sharing consent is separately labeled in both portal locales", () => {
  expect(createWebTranslator("en").t("web.portal.auth.shareDisplayZone"))
    .toBe("Share my time zone with my provider’s crew");
  expect(createWebTranslator("pt-PT").t("web.portal.auth.shareDisplayZone"))
    .toBe("Partilhar o meu fuso horário com a equipa do meu prestador de serviços");
});

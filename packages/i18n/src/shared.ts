import catalogs from "./generated/shared";
import { bindTranslator, createNamespace } from "./translator";
import type { MessageKey } from "./generated/types";

export const sharedNamespace = createNamespace(catalogs);
export const createSharedTranslator = bindTranslator<"shared">(sharedNamespace);

type SharedEnumLabelKey = Extract<MessageKey<"shared">, `shared.trade.${string}` | `shared.sessionCategory.${string}`>;

export function sharedEnumLabel(t: (key: SharedEnumLabelKey) => string, key: SharedEnumLabelKey): string {
  switch (key) {
    case "shared.trade.carpentry": return t("shared.trade.carpentry");
    case "shared.trade.electrical": return t("shared.trade.electrical");
    case "shared.trade.plumbing": return t("shared.trade.plumbing");
    case "shared.trade.painting": return t("shared.trade.painting");
    case "shared.trade.locksmith": return t("shared.trade.locksmith");
    case "shared.trade.general": return t("shared.trade.general");
    case "shared.trade.other": return t("shared.trade.other");
    case "shared.trade.unspecified": return t("shared.trade.unspecified");
    case "shared.sessionCategory.pilates": return t("shared.sessionCategory.pilates");
    case "shared.sessionCategory.massage": return t("shared.sessionCategory.massage");
    case "shared.sessionCategory.sportCoaching": return t("shared.sessionCategory.sportCoaching");
    case "shared.sessionCategory.tours": return t("shared.sessionCategory.tours");
    case "shared.sessionCategory.other": return t("shared.sessionCategory.other");
  }
}

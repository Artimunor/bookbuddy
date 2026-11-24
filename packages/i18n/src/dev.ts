import mobile from "./generated/mobile";
import mobilePseudo from "./generated/mobile.pseudo";
import push from "./generated/push";
import pushPseudo from "./generated/push.pseudo";
import shared from "./generated/shared";
import sharedPseudo from "./generated/shared.pseudo";
import web from "./generated/web";
import webPseudo from "./generated/web.pseudo";
import type { Surface } from "./generated/types";
import { bindTranslator, createNamespace, type LocaleInput, type Translator } from "./translator";

const sharedNamespace = createNamespace(shared, sharedPseudo);
const factories: { [S in Surface]: (locale?: LocaleInput) => Translator<S> } = {
  shared: bindTranslator<"shared">(sharedNamespace),
  mobile: bindTranslator<"mobile">(sharedNamespace, createNamespace(mobile, mobilePseudo)),
  web: bindTranslator<"web">(sharedNamespace, createNamespace(web, webPseudo)),
  push: bindTranslator<"push">(sharedNamespace, createNamespace(push, pushPseudo)),
};

export function createTranslator<S extends Surface>(surface: S, locale?: LocaleInput): Translator<S> {
  return factories[surface](locale);
}

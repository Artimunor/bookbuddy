import catalogs from "./generated/push";
import { sharedNamespace } from "./shared";
import { bindTranslator, createNamespace } from "./translator";

export const createPushTranslator = bindTranslator<"push">(sharedNamespace, createNamespace(catalogs));

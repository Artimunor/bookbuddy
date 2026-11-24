import catalogs from "./generated/mobile";
import { sharedNamespace } from "./shared";
import { bindTranslator, createNamespace } from "./translator";

export const createMobileTranslator = bindTranslator<"mobile">(sharedNamespace, createNamespace(catalogs));

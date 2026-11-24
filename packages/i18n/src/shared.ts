import catalogs from "./generated/shared";
import { bindTranslator, createNamespace } from "./translator";

export const sharedNamespace = createNamespace(catalogs);
export const createSharedTranslator = bindTranslator<"shared">(sharedNamespace);

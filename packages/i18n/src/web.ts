import catalogs from "./generated/web";
import { sharedNamespace } from "./shared";
import { bindTranslator, createNamespace } from "./translator";

export const createWebTranslator = bindTranslator<"web">(sharedNamespace, createNamespace(catalogs));

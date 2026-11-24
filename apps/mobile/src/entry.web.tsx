import "@expo/metro-runtime";
import { registerRootComponent } from "expo";
import { ApiProvider } from "./api";
import { SessionProvider } from "./session";
import { LocaleProvider } from "./i18n";
import ScreenPreviewCatalog from "./preview/screens";

function Preview() {
  return (
    <ApiProvider>
      <SessionProvider>
        <LocaleProvider>
          <ScreenPreviewCatalog />
        </LocaleProvider>
      </SessionProvider>
    </ApiProvider>
  );
}

registerRootComponent(Preview);

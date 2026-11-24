import "@expo/metro-runtime";
import { registerRootComponent } from "expo";
import { ApiProvider } from "./api";
import { SessionProvider } from "./session";
import PreviewGallery from "./preview/gallery";

function Preview() {
  return (
    <ApiProvider>
      <SessionProvider>
        <PreviewGallery />
      </SessionProvider>
    </ApiProvider>
  );
}

registerRootComponent(Preview);

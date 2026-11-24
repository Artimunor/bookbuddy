import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import type { ScreenPreview } from "./types";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PreviewLocaleProvider, useT } from "../../i18n";
import { Copy } from "../../ui/controls/shared";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import PreviewGallery from "../gallery";

interface PreviewContext {
  keys(): string[];
  (key: string): { previews: ScreenPreview[] };
}
declare const require: { context(directory: string, recursive: boolean, filter: RegExp): PreviewContext };
const screens = require.context("../../screens", true, /^\.\/[^/]+\/preview\.tsx$/);
const previews = screens.keys().sort().flatMap((path) => screens(path).previews);
const web = globalThis as typeof globalThis & { location?: { search: string } };

function previewHref({ id, state }: ScreenPreview) {
  return `?${new URLSearchParams({ screen: id, state })}`;
}

export default function ScreenPreviewCatalog() {
  const params = new URLSearchParams(web.location?.search);
  if (params.get("gallery") === "kit") return <PreviewGallery />;
  const active = previews.find(({ id, state }) => id === params.get("screen") && state === params.get("state"));
  const scheme = params.get("scheme") === "dark" ? "dark" : "light";
  const field = params.get("field") === "true";
  if (!active) return <BeaconThemeProvider scheme={scheme}><Index /></BeaconThemeProvider>;
  const Render = active.render;
  return (
    <SafeAreaProvider>
      <BeaconThemeProvider scheme={scheme} field={field}>
        <PreviewLocaleProvider initialLocale={params.get("locale") === "pt-PT" ? "pt-PT" : "en"}>
          <PreviewFrame><Render /></PreviewFrame>
        </PreviewLocaleProvider>
      </BeaconThemeProvider>
    </SafeAreaProvider>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const { color, space } = useBeaconTheme();
  const { width } = useWindowDimensions();
  if (width < 600) return children;
  return (
    <View style={{ flex: 1, backgroundColor: color.subtle, alignItems: "center" }}>
      <a href="?" style={{ color: color.brandInk, padding: space.grid[3] }}>{t("mobile.auth.preview.back")}</a>
      <View style={{ width: "100%", maxWidth: 480, flex: 1 }}>{children}</View>
    </View>
  );
}

function Index() {
  const t = useT();
  const { space, color } = useBeaconTheme();
  const ids = [...new Set(previews.map(({ id }) => id))];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.canvas }}>
      <View style={{ width: "100%", maxWidth: 780, alignSelf: "center", padding: space.grid[6], gap: space.grid[5] }}>
        <Copy variant="display" accessibilityRole="header">{t("mobile.auth.preview.title")}</Copy>
        <a href="?gallery=kit" style={{ color: color.brandInk }}>{t("mobile.auth.preview.controls")}</a>
        {ids.map((id) => <View key={id} style={{ gap: space.grid[2] }}>
          <Copy variant="sectionTitle" accessibilityRole="header">{id}</Copy>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[2] }}>
            {previews.filter((item) => item.id === id).map((item) => (
              <a key={item.state} href={previewHref(item)} style={{ color: color.brandInk, padding: space.grid[2] }}>{item.state}</a>
            ))}
          </View>
        </View>)}
      </View>
    </ScrollView>
  );
}

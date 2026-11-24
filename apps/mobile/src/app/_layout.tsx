import { Stack } from "expo-router";
import { ApiProvider } from "../api";
import { LocaleProvider } from "../i18n";
import { SessionProvider } from "../session";
import { DisplaySettingsProvider } from "../screens/s-12/preferences";

export default function RootLayout() {
  return (
    <ApiProvider>
      <SessionProvider>
        <LocaleProvider>
          <DisplaySettingsProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(sheets)" options={{ presentation: "formSheet" }} />
              <Stack.Screen name="(modals)" options={{ presentation: "fullScreenModal" }} />
            </Stack>
          </DisplaySettingsProvider>
        </LocaleProvider>
      </SessionProvider>
    </ApiProvider>
  );
}

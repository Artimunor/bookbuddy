import { Stack } from "expo-router";
import { ApiProvider } from "../api";
import { LocaleProvider } from "../i18n";
import { SessionProvider } from "../session";
import { BeaconThemeProvider } from "../ui/theme";

export default function RootLayout() {
  return (
    <ApiProvider>
      <SessionProvider>
        <LocaleProvider>
          <BeaconThemeProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(sheets)" options={{ presentation: "formSheet" }} />
              <Stack.Screen name="(modals)" options={{ presentation: "fullScreenModal" }} />
            </Stack>
          </BeaconThemeProvider>
        </LocaleProvider>
      </SessionProvider>
    </ApiProvider>
  );
}

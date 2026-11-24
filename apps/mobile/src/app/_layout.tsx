import { Stack } from "expo-router";
import { ApiProvider } from "../api";
import { SessionProvider } from "../session";

export default function RootLayout() {
  return (
    <ApiProvider>
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(sheets)" options={{ presentation: "formSheet" }} />
          <Stack.Screen name="(modals)" options={{ presentation: "fullScreenModal" }} />
        </Stack>
      </SessionProvider>
    </ApiProvider>
  );
}

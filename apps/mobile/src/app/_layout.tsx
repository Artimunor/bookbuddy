import { Stack, useRouter, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { ApiProvider } from "../api";
import { useApiAccess } from "../api/provider";
import { LocaleProvider } from "../i18n";
import { SessionProvider, useSession } from "../session";
import { DisplaySettingsProvider } from "../screens/s-12/preferences";
import { pushPath, refreshPush } from "../system/push";
import { StatusCardHost } from "../system/status-cards";

function PushResponses() {
  const router = useRouter();
  const { client } = useApiAccess();
  const { session } = useSession();
  useEffect(() => {
    if (Platform.OS === "web") return;
    const open = (response: Notifications.NotificationResponse) => {
      const path = pushPath(response.notification.request.content.data);
      if (path) router.push(path as Href);
    };
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) { open(response); void Notifications.clearLastNotificationResponseAsync(); }
    });
    return () => listener.remove();
  }, [router]);
  useEffect(() => {
    if (Platform.OS === "web" || !client || !session) return;
    const listener = Notifications.addPushTokenListener((token) => { void refreshPush(client, session.accountId, token).catch(() => undefined); });
    return () => listener.remove();
  }, [client, session?.accountId]);
  return null;
}

export default function RootLayout() {
  return (
    <ApiProvider>
      <SessionProvider>
        <LocaleProvider>
          <DisplaySettingsProvider>
            <PushResponses />
            <StatusCardHost />
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

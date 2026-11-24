import { Tabs } from "expo-router/js-tabs";

export const unstable_settings = { anchor: "now" };

export default function WorkerTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false }}>
      <Tabs.Screen name="now" />
      <Tabs.Screen name="shifts" />
      <Tabs.Screen name="messages" />
    </Tabs>
  );
}

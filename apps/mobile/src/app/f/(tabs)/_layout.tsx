import { Tabs } from "expo-router/js-tabs";

export const unstable_settings = { anchor: "now" };

export default function ForemanTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false }}>
      <Tabs.Screen name="now" />
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="crew" />
      <Tabs.Screen name="messages" />
    </Tabs>
  );
}

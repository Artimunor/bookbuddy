import { Tabs } from "expo-router/js-tabs";

export const unstable_settings = { anchor: "now" };

export default function ProviderTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false }}>
      <Tabs.Screen name="now" />
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="people" />
    </Tabs>
  );
}

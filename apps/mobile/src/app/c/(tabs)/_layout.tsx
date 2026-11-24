import { Tabs } from "expo-router/js-tabs";

export const unstable_settings = { anchor: "now" };

export default function CustomerTabs() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false }}>
      <Tabs.Screen name="now" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="messages" />
    </Tabs>
  );
}

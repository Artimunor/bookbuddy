import { Tabs } from "expo-router/js-tabs";
import { useT } from "../../../i18n";
import { beaconTab, useBeaconTabOptions } from "../../../ui/controls/tab-chrome";

export const unstable_settings = { anchor: "now" };

export default function CustomerTabs() {
  const t = useT();
  const screenOptions = useBeaconTabOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="now" options={beaconTab("now", t("mobile.customerHome.now"))} />
      <Tabs.Screen name="bookings" options={beaconTab("bookings", t("mobile.customerHome.bookings"))} />
      <Tabs.Screen name="messages" options={beaconTab("messages", t("mobile.chat.messages"))} />
    </Tabs>
  );
}

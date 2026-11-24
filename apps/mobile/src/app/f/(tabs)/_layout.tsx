import { Tabs } from "expo-router/js-tabs";
import { useT } from "../../../i18n";
import { beaconTab, useBeaconTabOptions } from "../../../ui/controls/tab-chrome";

export const unstable_settings = { anchor: "now" };

export default function ForemanTabs() {
  const t = useT();
  const screenOptions = useBeaconTabOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="now" options={beaconTab("now", t("mobile.foremanHome.now"))} />
      <Tabs.Screen name="jobs" options={beaconTab("jobs", t("mobile.foremanHome.jobs"))} />
      <Tabs.Screen name="crew" options={beaconTab("crew", t("mobile.crew.title"))} />
      <Tabs.Screen name="messages" options={beaconTab("messages", t("mobile.chat.messages"))} />
    </Tabs>
  );
}

import { Tabs } from "expo-router/js-tabs";
import { useT } from "../../../i18n";
import { beaconTab, useBeaconTabOptions } from "../../../ui/controls/tab-chrome";

export const unstable_settings = { anchor: "now" };

export default function ProviderTabs() {
  const t = useT();
  const screenOptions = useBeaconTabOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="now" options={beaconTab("now", t("mobile.customerHome.now"))} />
      <Tabs.Screen name="jobs" options={beaconTab("jobs", t("mobile.provider.jobs"))} />
      <Tabs.Screen name="people" options={beaconTab("people", t("mobile.places.people"))} />
    </Tabs>
  );
}

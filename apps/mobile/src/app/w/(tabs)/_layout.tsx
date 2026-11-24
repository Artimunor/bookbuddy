import { Tabs } from "expo-router/js-tabs";
import { useT } from "../../../i18n";
import { beaconTab, useBeaconTabOptions } from "../../../ui/controls/tab-chrome";

export const unstable_settings = { anchor: "now" };

export default function WorkerTabs() {
  const t = useT();
  const screenOptions = useBeaconTabOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="now" options={beaconTab("now", t("mobile.workerOffer.now"))} />
      <Tabs.Screen name="shifts" options={beaconTab("shifts", t("mobile.crewSchedule.shifts"))} />
      <Tabs.Screen name="messages" options={beaconTab("messages", t("mobile.chat.messages"))} />
    </Tabs>
  );
}

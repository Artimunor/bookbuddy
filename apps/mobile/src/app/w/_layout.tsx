import { Stack } from "expo-router";

export const unstable_settings = { anchor: "(tabs)" };

export default function WorkerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

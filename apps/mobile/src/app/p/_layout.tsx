import { Stack } from "expo-router";

export const unstable_settings = { anchor: "(tabs)" };

export default function ProviderLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

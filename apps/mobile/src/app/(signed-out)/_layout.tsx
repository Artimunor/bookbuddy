import { Stack } from "expo-router";

export const unstable_settings = { anchor: "welcome" };

export default function SignedOutLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

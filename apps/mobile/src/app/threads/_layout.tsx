import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "[threadId]" };

export default function ThreadsLayout() {
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="[threadId]" />
    <Stack.Screen name="[threadId]/details" options={{ presentation: "transparentModal", animation: "none", contentStyle: { backgroundColor: "transparent" } }} />
  </Stack>;
}

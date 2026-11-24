import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(sheets)" options={{ presentation: "formSheet" }} />
      <Stack.Screen name="(modals)" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

/** Inbox draws its own ScreenHeader, so no native title bar. */
export default function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="inbox" options={{ title: 'Inbox' }} />
    </Stack>
  );
}

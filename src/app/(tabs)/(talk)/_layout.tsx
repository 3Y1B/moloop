import { Stack } from 'expo-router';

/** Voice mode is full-canvas: the orb and transcript are the UI, no title bar. */
export default function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="talk" options={{ title: 'Talk' }} />
    </Stack>
  );
}

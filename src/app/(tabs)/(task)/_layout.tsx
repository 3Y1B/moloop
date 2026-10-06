import { Stack } from 'expo-router';

/** My task draws its own compact header (identity chip + talk orb), so no native title bar. */
export default function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'My task' }} />
    </Stack>
  );
}

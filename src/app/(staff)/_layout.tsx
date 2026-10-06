import { Redirect, Stack } from 'expo-router';

import { useRole } from '@/data/hooks';

/** The volunteer and lead app: one screen, the map with the sheet. Everything else opens over it. */
export default function StaffLayout() {
  const role = useRole();
  if (role === 'guest') return <Redirect href="/(guest)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Moloop' }} />
    </Stack>
  );
}

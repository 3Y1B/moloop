import { Redirect, Stack } from 'expo-router';

import { useSpokenBriefs } from '@/components/voice/use-spoken-briefs';
import { useRole, useSnapshot } from '@/data/hooks';

/** The volunteer and lead app: one screen, the map with the sheet. Everything else opens over it. */
export default function StaffLayout() {
  const s = useSnapshot();
  const role = useRole();
  // New tasks and backup calls are read out while the app is open.
  useSpokenBriefs();
  // Live backend only: the mock always has someone signed in.
  if (!s.meId) return s.status === 'ready' ? <Redirect href="/sign-in" /> : null;
  if (role === 'guest') return <Redirect href="/(guest)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Moloop' }} />
    </Stack>
  );
}

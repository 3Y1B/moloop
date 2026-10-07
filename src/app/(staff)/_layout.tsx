import { Redirect, Stack } from 'expo-router';

import { useSpokenBriefs } from '@/components/voice/use-spoken-briefs';
import { useRole, useSnapshot } from '@/data/hooks';
import { homeFor } from '@/lib/home';

/** The volunteer and lead app: one screen, the map with the sheet. Everything else opens over it. Mo has a console. */
export default function StaffLayout() {
  const s = useSnapshot();
  const home = homeFor(useRole());
  // New tasks and backup calls are read out while the app is open.
  useSpokenBriefs();
  if (!s.meId) return s.status === 'ready' ? <Redirect href="/sign-in" /> : null;
  if (home && home !== '(staff)') return <Redirect href={`/${home}`} />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Moloop' }} />
    </Stack>
  );
}

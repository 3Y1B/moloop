import { Redirect, Stack } from 'expo-router';

import { useRole, useSnapshot } from '@/data/hooks';
import { homeFor } from '@/lib/home';

/** The festival-goer's app. Crew signed in here go to their own. */
export default function GuestLayout() {
  const s = useSnapshot();
  const home = homeFor(useRole());
  if (!s.meId) return s.status === 'ready' ? <Redirect href="/sign-in" /> : null;
  if (home && home !== '(guest)') return <Redirect href={`/${home}`} />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Ask' }} />
      <Stack.Screen name="request/[id]" options={{ title: 'Request' }} />
    </Stack>
  );
}

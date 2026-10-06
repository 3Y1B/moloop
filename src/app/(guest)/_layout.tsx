import { Redirect, Stack } from 'expo-router';

import { useRole } from '@/data/hooks';

/** The festival-goer's app. Anyone else signed in goes to the volunteer tabs. */
export default function GuestLayout() {
  const role = useRole();
  if (role && role !== 'guest') return <Redirect href="/(staff)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Ask' }} />
      <Stack.Screen name="request/[id]" options={{ title: 'Request' }} />
    </Stack>
  );
}

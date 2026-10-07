import { router, type Href } from 'expo-router';

/** Direct links and reloads may have no previous screen. Replace instead of issuing an unhandled back. */
export function goBack(fallback: Href = '/(staff)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

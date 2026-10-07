import { router, type Href } from 'expo-router';

/**
 * Back, or (a direct link, a reload, the web) to `fallback` when there's no screen behind this one, instead of an
 * unhandled back. Crew fall back to their map; a festival-goer's screens pass '/(guest)'.
 */
export function goBack(fallback: Href = '/(staff)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

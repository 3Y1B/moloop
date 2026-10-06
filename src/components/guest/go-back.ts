import { router } from 'expo-router';

/** Back that also works on the web, where a request page can be opened straight from a link. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/(guest)');
}

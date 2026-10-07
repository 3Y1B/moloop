import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTopBarMetrics } from '@/components/ui/top-bar';
import { useDockHeight } from '@/components/voice/voice-dock';

/**
 * Sizes for a map-and-sheet screen. The sheet stops at `peek` (just the headline), half the screen,
 * and just under the top controls, so they stay reachable. The map frames its subject in the part
 * the sheet and the controls leave clear at the middle stop.
 */
export function useMapLayout(peek: number, { dock = true }: { dock?: boolean } = {}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dockHeight = useDockHeight();
  const { contentTop } = useTopBarMetrics();
  const bottomInset = dock ? dockHeight : insets.bottom;
  const full = height - (contentTop + 4);
  const low = Math.min(bottomInset + peek, full);
  const mid = Math.min(Math.max(Math.round(height * 0.5), low), full);
  return {
    detents: [low, mid, full],
    bottomInset,
    frame: { top: contentTop / height, bottom: mid / height },
  };
}

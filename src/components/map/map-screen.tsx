import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDockHeight } from '@/components/voice/voice-dock';
import { MAP_BUTTON } from './map-button';

/**
 * Sizes for a map-and-sheet screen. The sheet stops at `peek` (just the headline), half the screen,
 * and just under the top controls, so they stay reachable. The map frames its subject in the part
 * the sheet and the controls leave clear at the middle stop.
 */
export function useMapLayout(peek: number, { dock = true }: { dock?: boolean } = {}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const dockHeight = useDockHeight();
  const bottomInset = dock ? dockHeight : insets.bottom;
  const barTop = insets.top + 8;
  const full = height - (barTop + MAP_BUTTON + 12);
  const low = Math.min(bottomInset + peek, full);
  const mid = Math.min(Math.max(Math.round(height * 0.5), low), full);
  return {
    detents: [low, mid, full],
    bottomInset,
    barTop,
    frame: { top: (barTop + MAP_BUTTON + 8) / height, bottom: mid / height },
  };
}

/** The row of floating controls along the top of the map. Touches between them reach the map. */
export function MapTopBar({ top, left, right }: { top: number; left?: ReactNode; right?: ReactNode }) {
  return (
    <View pointerEvents="box-none" style={[styles.bar, { top }]}>
      <View pointerEvents="box-none">{left}</View>
      <View pointerEvents="box-none" style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  right: { flexDirection: 'row', gap: 10 },
});

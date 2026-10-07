import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

/** Height of a control in the top bar (the round map buttons, the duty chip). */
export const TOP_BAR_CONTROL = 44;
/** Gap between the safe area and the bar's controls, and between the controls and what sits under them. */
const GAP = 8;

/**
 * Where the top bar sits. `top`: the controls' top edge. `height`: a control's height. `contentTop`: the first y clear
 * of the bar, for panels and map framing under it.
 */
export function useTopBarMetrics() {
  const top = useSafeAreaInsets().top + GAP;
  return { top, height: TOP_BAR_CONTROL, contentTop: top + TOP_BAR_CONTROL + GAP };
}

/**
 * The bar along the top of a screen. `floating`: controls over the map, no fill; touches between them reach the map.
 * `flat`: on the page's background. With a `title` the sides are a fixed width so it stays centred, and a hairline
 * runs under the bar (the in-app header); without one it's just the controls (Mo's tabs).
 */
export function TopBar({ left, title, right, variant = 'flat', divider }: {
  left?: ReactNode;
  title?: string;
  right?: ReactNode;
  variant?: 'floating' | 'flat';
  /** Hairline under a flat bar. Defaults to on when there's a title. */
  divider?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const titled = !!title;
  const row = (
    <>
      <View pointerEvents="box-none" style={[styles.side, titled && styles.fixed]}>{left}</View>
      {titled && (
        <Text variant="section" accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
      )}
      <View pointerEvents="box-none" style={[styles.side, styles.right, titled && styles.fixed]}>{right}</View>
    </>
  );

  if (variant === 'floating') {
    return (
      <View pointerEvents="box-none" style={[styles.floating, { top: insets.top + GAP }]}>
        {row}
      </View>
    );
  }
  return (
    <View
      style={[
        { paddingTop: insets.top, backgroundColor: theme.background },
        (divider ?? titled) && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}>
      <View style={styles.flat}>{row}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  flat: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, paddingHorizontal: 16,
    paddingVertical: GAP,
  },
  side: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fixed: { width: 72 },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
});

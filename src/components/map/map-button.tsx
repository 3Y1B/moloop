import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { CountBadge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { haptic, pressedStyle } from '@/components/ui/pressable';
import { TOP_BAR_CONTROL } from '@/components/ui/top-bar';
import { Shadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAP_BUTTON = TOP_BAR_CONTROL;

/**
 * Round control floating over the map. Same soft lift as the sheet, so it reads above the plan. `flat` is the same
 * control on a plain page: no lift, a hairline instead.
 */
export function MapButton({ label, sf, md, badge, flat = false, onPress, style }: {
  label: string;
  sf: string;
  md: string;
  badge?: number;
  flat?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} new` : label}
      hitSlop={6}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        flat ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border } : Shadow.floating,
        { backgroundColor: theme.card },
        pressedStyle(pressed),
        style,
      ]}>
      <Icon sf={sf} md={md} size={18} color={theme.text} />
      <CountBadge count={badge ?? 0} outline style={styles.badge} />
    </Pressable>
  );
}


const styles = StyleSheet.create({
  button: {
    width: MAP_BUTTON,
    height: MAP_BUTTON,
    borderRadius: MAP_BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: -3, right: -3 },
});

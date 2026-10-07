import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { haptic, pressedStyle } from './pressable';

/** Round control: a flat card-coloured disc with a hairline edge. */
export function CircleButton({ size = 44, label, onPress, onLongPress, children, style }: {
  size?: number;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        haptic('selection');
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={({ pressed }) => [shape, pressedStyle(pressed), style]}>
      <View style={[shape, styles.center, { backgroundColor: theme.card, borderColor: theme.border }]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
});

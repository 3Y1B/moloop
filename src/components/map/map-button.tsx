import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

export const MAP_BUTTON = 44;

/** Round control floating over the map. Same soft lift as the sheet, so it reads above the plan. */
export function MapButton({ label, sf, md, badge, onPress, style }: {
  label: string;
  sf: string;
  md: string;
  badge?: number;
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
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.button, { backgroundColor: theme.card, opacity: pressed ? 0.7 : 1 }, style]}>
      <Icon sf={sf} md={md} size={18} color={theme.text} />
      {!!badge && (
        <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.card }]}>
          <Text style={[styles.badgeText, { color: theme.onTint }]}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The soft lift every floating map control shares. */
export const floating = { boxShadow: '0 2px 10px rgba(17, 24, 39, 0.12)' } as const;

const styles = StyleSheet.create({
  button: {
    width: MAP_BUTTON,
    height: MAP_BUTTON,
    borderRadius: MAP_BUTTON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...floating,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

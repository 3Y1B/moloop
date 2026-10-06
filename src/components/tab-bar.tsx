import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TabItem = { name: string; label: string; sf: string; sfSelected: string; md: string; badge?: number };

/** Flat bottom bar: hairline top edge, accent colour on the focused tab. Same on every platform. */
export function TabBar({ items }: { items: TabItem[] }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom - 8, 6), backgroundColor: theme.card, borderTopColor: theme.border },
      ]}>
      {items.map((item) => (
        <TabTrigger key={item.name} name={item.name} asChild>
          <TabButton item={item} />
        </TabTrigger>
      ))}
    </View>
  );
}

function TabButton({ item, isFocused, ...props }: TabTriggerSlotProps & { item: TabItem }) {
  const theme = useTheme();
  const color = isFocused ? theme.tint : theme.textTertiary;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [styles.item, { opacity: pressed ? 0.6 : 1 }]}>
      <View>
        <Icon sf={isFocused ? item.sfSelected : item.sf} md={item.md} size={21} color={color} />
        {!!item.badge && (
          <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.card }]}>
            <Text style={styles.badgeText}>{item.badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, { color }]}>{item.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, height: BottomTabInset, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11, fontWeight: '500' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -11,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

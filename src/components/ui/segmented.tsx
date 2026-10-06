import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Segment<K extends string> = { key: K; label: string; badge?: number };

/** Two or three flat choices in a track; the chosen one sits on a raised card. */
export function Segmented<K extends string>({ segments, value, onChange }: {
  segments: Segment<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {segments.map((s) => {
        const on = s.key === value;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(s.key);
            }}
            style={[styles.segment, on && [styles.on, { backgroundColor: theme.card }]]}>
            <Text style={[styles.label, { color: on ? theme.text : theme.textSecondary }]}>{s.label}</Text>
            {!!s.badge && (
              <View style={[styles.badge, { backgroundColor: theme.danger }]}>
                <Text style={styles.badgeText}>{s.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, borderRadius: Radius.control, gap: 3 },
  segment: {
    flex: 1, height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: Radius.control - 3, borderCurve: 'continuous',
  },
  on: { boxShadow: '0 1px 3px rgba(17, 24, 39, 0.1)' },
  label: { fontSize: Type.footnote, fontWeight: '600' },
  badge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

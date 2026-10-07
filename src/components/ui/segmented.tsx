import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Shadow, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CountBadge } from './badge';
import { haptic } from './pressable';

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
              haptic('selection');
              onChange(s.key);
            }}
            style={[styles.segment, on && [Shadow.raised, { backgroundColor: theme.card }]]}>
            <Text style={[styles.label, { color: on ? theme.text : theme.textSecondary }]}>{s.label}</Text>
            <CountBadge count={s.badge ?? 0} />
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
  label: { fontSize: Type.footnote, fontWeight: '600' },
});

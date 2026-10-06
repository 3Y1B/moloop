import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { VENUE_ZONES } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';

export const NEAR_ME = 'near-me';

/** Mock GPS: where "Near me" lands until real location does. */
const MOCK_GPS_ZONE = 'food-alley';

/** The zone a choice stands for. */
export const resolveZone = (choice: string) => (choice === NEAR_ME ? MOCK_GPS_ZONE : choice);

/** Where they are: "Near me" or a zone. One row of chips. */
export function ZonePicker({ value, onChange }: { value: string; onChange: (choice: string) => void }) {
  const theme = useTheme();
  const choices = [{ slug: NEAR_ME, label: 'Near me' }, ...Object.values(VENUE_ZONES)];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {choices.map((c) => {
        const on = c.slug === value;
        const color = on ? theme.tint : theme.textSecondary;
        return (
          <Pressable
            key={c.slug}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(c.slug);
            }}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: on ? theme.tint : theme.border, backgroundColor: on ? `${theme.tint}14` : theme.card, opacity: pressed ? 0.7 : 1 },
            ]}>
            {c.slug === NEAR_ME && <Icon sf="location.fill" md="near_me" size={12} color={color} />}
            <Text style={[styles.text, { color }]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12,
    borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth * 2,
  },
  text: { fontSize: Type.footnote, fontWeight: '600' },
});

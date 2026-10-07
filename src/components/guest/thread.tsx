import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Type } from '@/constants/theme';
import type { GuestThreadEntry } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const WHO: Record<GuestThreadEntry['from'], string> = { guest: 'You', ai: 'Moloop', staff: 'Staff' };

/** What was said, by whom, oldest first. A plain list: no bubbles. */
export function Thread({ entries }: { entries: GuestThreadEntry[] }) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      {entries.map((e, i) => (
        <Animated.View key={`${e.at}-${i}`} entering={FadeIn.duration(200)} style={styles.entry}>
          <Text style={[styles.who, { color: theme.textSecondary }]}>{e.name ?? WHO[e.from]}</Text>
          <Text style={[styles.text, { color: theme.text }]} selectable>{e.text}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  entry: { gap: 4 },
  who: { fontSize: Type.footnote, lineHeight: 16 },
  text: { fontSize: Type.body, lineHeight: 21 },
});

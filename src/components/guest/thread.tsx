import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Radius, Type } from '@/constants/theme';
import { clockTime } from '@/lib/format';
import type { GuestThreadEntry } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const WHO: Record<GuestThreadEntry['from'], string> = { guest: 'You', ai: 'Moloop', staff: 'Staff' };

/** The request as a conversation: theirs on the right, Moloop and staff replies on the left. */
export function Thread({ entries }: { entries: GuestThreadEntry[] }) {
  return (
    <View style={styles.list}>
      {entries.map((e, i) => <Bubble key={`${e.at}-${i}`} entry={e} />)}
    </View>
  );
}

function Bubble({ entry }: { entry: GuestThreadEntry }) {
  const theme = useTheme();
  const mine = entry.from === 'guest';
  return (
    <Animated.View entering={FadeInDown.duration(220)} style={[styles.item, mine ? styles.right : styles.left]}>
      <Text style={[styles.meta, { color: theme.textTertiary }, mine && styles.metaRight]}>
        {mine ? clockTime(entry.at) : `${entry.name ?? WHO[entry.from]} · ${clockTime(entry.at)}`}
      </Text>
      <View style={[styles.bubble, { backgroundColor: mine ? `${theme.tint}14` : theme.backgroundElement }]}>
        <Text style={[styles.text, { color: theme.text }]} selectable>{entry.text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  item: { maxWidth: '86%', gap: 4 },
  left: { alignSelf: 'flex-start' },
  right: { alignSelf: 'flex-end' },
  meta: { fontSize: Type.caption, fontWeight: '500', paddingHorizontal: 4 },
  metaRight: { textAlign: 'right' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.card, borderCurve: 'continuous' },
  text: { fontSize: Type.body, lineHeight: 21 },
});

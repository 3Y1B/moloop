import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { personMarker } from '@/components/map/crew-map';
import { Dot } from '@/components/map/map-markers';
import { ListRow } from '@/components/ui/list-row';
import { PressableOpacity } from '@/components/ui/pressable';
import { StatusLine } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import type { TeamMember } from '@/data/hooks';
import type { Status } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';

/**
 * A person in a flat list: their map dot, name, and where they stand. Opens the Person sheet. `trailing` sits on the
 * right as its own control (the task they're on), beside the person, not inside them: a button can't hold a button.
 */
export function PersonRow({ member, trailing }: { member: TeamMember; trailing?: ReactNode }) {
  const theme = useTheme();
  const { volunteer: v, status } = member;
  const on = member.task ?? member.helping;
  const off = v.duty === 'off_shift';
  // A plain "Lost child · 6 min" already names the task; asked for help, quiet and helping say which task after.
  const line: Status = on && status.tone !== 'neutral' ? { ...status, detail: on.title } : status;
  const dot = personMarker(member, theme);
  return (
    <ListRow flush divider trailing={trailing}>
      <PressableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${v.name}, ${status.label}`}
        onPress={() => router.push({ pathname: '/person/[id]', params: { id: v.id } })}
        style={styles.person}>
        {/* As on the map: red when they asked for help, ringed while on a task, faded off shift. */}
        <Dot color={dot.needsHelp ? theme.danger : dot.color} initials={dot.initials} ring={dot.onTask || dot.needsHelp} stale={off} />
        <View style={styles.text}>
          <Text variant="rowTitle" tone={off ? 'tertiary' : 'primary'} numberOfLines={1}>{v.name}</Text>
          <StatusLine status={line} />
        </View>
      </PressableOpacity>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 1 },
});

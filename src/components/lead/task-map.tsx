import { StyleSheet, View } from 'react-native';

import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import { Radius } from '@/constants/theme';
import { useLookups } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

const HEIGHT = 130;

/** Small map for a task sheet: the spot, the volunteer with the person, and any backup on the way. */
export function TaskMap({ task }: { task: Task }) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const { volunteers, teams } = useLookups();
  if (!task.zoneSlug) return null;

  const color = (task.teamSlug && teams[task.teamSlug]?.color) || theme.tint;
  const markers: MapMarker[] = [];
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const at = zoneSpot(task.zoneSlug, 1);
  if (owner && at) {
    markers.push({ kind: 'volunteer', id: owner.id, at, color, initials: initials(owner.name), onTask: true, needsHelp: needsResponse(task) });
  }
  task.helperIds.forEach((id, i) => {
    const v = volunteers[id];
    const spot = v && zoneSpot(v.zoneSlug, i + 2);
    if (v && spot) markers.push({ kind: 'volunteer', id, at: spot, color, initials: initials(v.name), onTask: true });
  });

  return (
    <View style={styles.wrap}>
      <VenueMap route={null} me={null} target={task.zoneSlug} targetColor={accent} markers={markers} interactive={false} style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: HEIGHT, borderRadius: Radius.control, borderCurve: 'continuous', overflow: 'hidden' },
});

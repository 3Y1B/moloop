import { StyleSheet, View } from 'react-native';

import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import { Radius } from '@/constants/theme';
import { useLookups, useSnapshot } from '@/data/hooks';
import { initials } from '@/lib/format';
import { needsResponse } from '@/lib/lifecycle';
import { placeOf } from '@/lib/presence';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

const HEIGHT = 130;

/** Small map for a task sheet: the spot, the volunteer and any backup, where their phones say (else beside the spot). */
export function TaskMap({ task }: { task: Task }) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const { volunteers, teams } = useLookups();
  const { positions, now } = useSnapshot();
  if (!task.zoneSlug) return null;

  const color = (task.teamSlug && teams[task.teamSlug]?.color) || theme.tint;
  const markers: MapMarker[] = [];
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const ownerLive = placeOf(positions, owner?.id, now);
  const at = ownerLive?.at ?? zoneSpot(task.zoneSlug, 1);
  if (owner && at) {
    markers.push({
      kind: 'volunteer', id: owner.id, at, color, initials: initials(owner.name), onTask: true, needsHelp: needsResponse(task), stale: ownerLive?.stale,
    });
  }
  task.helperIds.forEach((id, i) => {
    const v = volunteers[id];
    const live = placeOf(positions, id, now);
    const spot = live?.at ?? (v && zoneSpot(v.zoneSlug, i + 2));
    if (v && spot) markers.push({ kind: 'volunteer', id, at: spot, color, initials: initials(v.name), onTask: true, stale: live?.stale });
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

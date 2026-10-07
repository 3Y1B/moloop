import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { personSpot, volunteerMarker } from '@/components/map/people';
import { VenueMap, zoneSpot, type MapMarker } from '@/components/map/venue-map';
import { Radius } from '@/constants/theme';
import { useLookups, useSnapshot } from '@/data/hooks';
import { isQuiet, needsResponse } from '@/lib/lifecycle';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

const HEIGHT = 130;

/**
 * Map for a task: the spot, the volunteer and any backup, where their phones say (else beside the spot).
 * A small thumbnail by default; with `fill` it takes its parent, pans, and frames clear of `frame`.
 * `candidates` puts teammates to pick on it too: the `picked` one in tint, the rest grey, tap one to pick.
 */
export function TaskMap({ task, fill, frame, candidates, picked, onPick, style }: {
  task: Task;
  fill?: boolean;
  frame?: { top: number; bottom: number };
  candidates?: string[];
  picked?: string | null;
  onPick?: (volunteerId: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const { volunteers, teams } = useLookups();
  const { positions, now } = useSnapshot();
  if (!task.zoneSlug) return null;

  const color = (task.teamSlug && teams[task.teamSlug]?.color) || theme.tint;
  const markers: MapMarker[] = [];
  // Each where their phone says, else spread round their zone (the owner round the task's).
  const spot = (id: string, zone: string | null, index: number) => personSpot(positions, id, now, () => zoneSpot(zone, index));
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const ownerAt = owner && spot(owner.id, task.zoneSlug, 1);
  if (owner && ownerAt) {
    markers.push(volunteerMarker(owner, ownerAt, { color, onTask: true, needsHelp: needsResponse(task) || isQuiet(task) }));
  }
  task.helpers.forEach(({ volunteerId: id }, i) => {
    const v = volunteers[id];
    const at = v && spot(id, v.zoneSlug, i + 2);
    if (v && at) markers.push(volunteerMarker(v, at, { color, onTask: true }));
  });
  candidates?.forEach((id, i) => {
    const v = volunteers[id];
    const at = v && spot(id, v.zoneSlug, task.helpers.length + i + 2);
    const on = id === picked;
    if (v && at) markers.push(volunteerMarker(v, at, { color: on ? theme.tint : theme.textTertiary, onTask: on }));
  });

  const pickable = new Set(candidates);
  return (
    <View style={[fill ? StyleSheet.absoluteFill : styles.thumb, style]}>
      <VenueMap
        route={null}
        me={null}
        target={task.zoneSlug}
        targetColor={accent}
        markers={markers}
        frame={frame}
        interactive={!!fill}
        onMarkerPress={onPick ? (m) => m.kind === 'volunteer' && pickable.has(m.id) && onPick(m.id) : undefined}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { height: HEIGHT, borderRadius: Radius.control, borderCurve: 'continuous', overflow: 'hidden' },
});

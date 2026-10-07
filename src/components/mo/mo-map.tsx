import { router } from 'expo-router';
import type { StyleProp, ViewStyle } from 'react-native';

import { openTaskSheet } from '@/components/lead/open-sheet';
import { useTeamMarkers } from '@/components/lead/team-map';
import { VenueMap } from '@/components/map/venue-map';
import { useCrew, useMyDot, useSnapshot } from '@/data/hooks';

/** The whole site with the whole crew and every open task on it. A task opens its sheet, a person theirs. */
export function MoMap({ frame, style }: { frame?: { top: number; bottom: number }; style?: StyleProp<ViewStyle> }) {
  const me = useMyDot();
  const crew = useCrew();
  const { proposals, tasks } = useSnapshot();
  const markers = useTeamMarkers(crew.members, crew.openTasks);
  return (
    <VenueMap
      route={null}
      me={me}
      markers={markers}
      onMarkerPress={(m) => {
        if (m.kind === 'task') return tasks[m.id] && openTaskSheet(tasks[m.id], proposals);
        router.push({ pathname: '/person/[id]', params: { id: m.id } });
      }}
      fit="site"
      frame={frame}
      style={style}
    />
  );
}

import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { CrewMap } from '@/components/map/crew-map';
import { TabInsets } from '@/components/mo/mo-page';
import { MoTopBar } from '@/components/mo/mo-top-bar';
import { TeamPills } from '@/components/mo/team-pills';
import { TaskDock } from '@/components/task/task-dock';
import { useTopBarMetrics } from '@/components/ui/top-bar';
import { useChosenTeam, useCrew } from '@/data/hooks';

/** Height of the floating pill row, so the site is framed clear of it. */
const PILLS = 52;

/**
 * The whole site, full screen, on a phone, with the team pills floating under the top bar: pick a team and only its
 * people and tasks stay on the map. A laptop has this map beside the column instead.
 */
export default function MapScreen() {
  const { height } = useWindowDimensions();
  const { contentTop } = useTopBarMetrics();
  const crew = useCrew(useChosenTeam());
  return (
    <View style={styles.screen}>
      <CrewMap crew={crew} style={StyleSheet.absoluteFill} frame={{ top: (contentTop + PILLS) / height, bottom: 0 }} />
      <MoTopBar overMap />
      <View style={[styles.pills, { top: contentTop }]}>
        <TeamPills overMap />
      </View>
      <TabInsets>
        <TaskDock />
      </TabInsets>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pills: { position: 'absolute', left: 0, right: 0, pointerEvents: 'box-none' },
});

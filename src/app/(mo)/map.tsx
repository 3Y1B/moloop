import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAP_BUTTON } from '@/components/map/map-button';
import { MoMap } from '@/components/mo/mo-map';
import { MoTopBar } from '@/components/mo/mo-top-bar';
import { TeamPills } from '@/components/mo/team-pills';
import { TaskDock } from '@/components/task/task-dock';

/** Height of the floating pill row, so the site is framed clear of it. */
const PILLS = 52;

/**
 * The whole site, full screen, on a phone, with the team pills floating under the top bar: pick a team and only its
 * people and tasks stay on the map. A laptop has this map beside the column instead.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const below = insets.top + 8 + MAP_BUTTON + 8;
  return (
    <View style={styles.screen}>
      <MoMap style={StyleSheet.absoluteFill} frame={{ top: (below + PILLS) / height, bottom: 0 }} />
      <MoTopBar overMap />
      <View style={[styles.pills, { top: below }]}>
        <TeamPills overMap />
      </View>
      {/* The tab bar already sits over the home indicator. */}
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
        <TaskDock />
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pills: { position: 'absolute', left: 0, right: 0, pointerEvents: 'box-none' },
});

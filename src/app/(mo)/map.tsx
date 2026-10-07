import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoMap } from '@/components/mo/mo-map';
import { MoTopBar } from '@/components/mo/mo-top-bar';
import { TaskDock } from '@/components/task/task-dock';

/** The whole site, full screen, on a phone. A laptop has this map beside the column instead. */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <MoMap style={StyleSheet.absoluteFill} />
      <MoTopBar overMap />
      {/* The tab bar already sits over the home indicator. */}
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
        <TaskDock />
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});

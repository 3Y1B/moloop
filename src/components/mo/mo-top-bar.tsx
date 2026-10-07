import { router } from 'expo-router';
import { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DemoButton } from '@/components/demo-panel';
import { DutyChip } from '@/components/duty-header';
import { MapButton } from '@/components/map/map-button';
import { MapTopBar } from '@/components/map/map-screen';
import { useInbox } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';

/** Whether Mo's shift details are open, shared by the bar on every tab. Provided by the (mo) layout. */
export const MoDuty = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

/**
 * Over every tab: Mo's shift on the left, the inbox on the right. Flat on a list; over the map it floats, exactly
 * as on the staff map.
 */
export function MoTopBar({ overMap = false }: { overMap?: boolean }) {
  const duty = useContext(MoDuty);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { unread } = useInbox();
  const flat = !overMap;
  const left = <DutyChip open={duty.open} onToggle={duty.toggle} flat={flat} />;
  const right = (
    <>
      <DemoButton flat={flat} />
      <MapButton label="Inbox" sf="tray" md="inbox" badge={unread} flat={flat} onPress={() => router.push('/inbox')} />
    </>
  );

  if (overMap) return <MapTopBar top={insets.top + 8} left={left} right={right} />;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: theme.background }]}>
      {left}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingBottom: 8 },
  right: { flexDirection: 'row', gap: 10 },
});

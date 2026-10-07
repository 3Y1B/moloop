import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DemoButton } from '@/components/demo-panel';
import { HiVisBar } from '@/components/guest/hivis-bar';
import { PlaceChip, PlacePicker } from '@/components/guest/place-picker';
import { RequestFold } from '@/components/guest/request-row';
import { MAP_BUTTON } from '@/components/map/map-button';
import { MapTopBar } from '@/components/map/map-screen';
import { VenueMap } from '@/components/map/venue-map';
import { useMyPlace, useMyRequests, useRepo } from '@/data/hooks';
import { nearestZone } from '@/lib/presence';
import { useTheme } from '@/hooks/use-theme';

/**
 * Ask: the site with you on it, and one bar that never moves. Hold it to talk, then Send; or type.
 * Their requests fold into one line above it.
 */
export default function AskScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const requests = useMyRequests();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const mine = useMyPlace();
  const [stack, setStack] = useState(200);
  const [picking, setPicking] = useState(false);
  /** A zone they chose by hand. Without one, where the phone is; without a fix on site, the AI reads the place from what they said. */
  const [picked, setPicked] = useState<string | null>(null);
  const near = mine ? nearestZone(mine) : null;
  const barTop = insets.top + 8;

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <VenueMap
        route={null}
        me={mine}
        fit="route"
        frame={{ top: (barTop + MAP_BUTTON + 8) / height, bottom: Math.min(0.6, stack / height) }}
        style={StyleSheet.absoluteFill}
      />
      <MapTopBar
        top={barTop}
        left={<PlaceChip picked={picked} near={near} located={!!mine} onPress={() => setPicking(true)} />}
        right={<DemoButton />}
      />

      <HiVisBar
        placeholder="Ask or report"
        onHeight={setStack}
        rest={requests.length > 0 && <RequestFold requests={requests} maxHeight={height * 0.4} />}
        onSend={async (text, clips) => {
          const id = await repo.guestAsk(text, picked ?? near, null, clips);
          router.push({ pathname: '/request/[id]', params: { id } });
        }}
      />

      {picking && (
        <PlacePicker
          picked={picked}
          onPick={(zone) => {
            setPicked(zone);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
});

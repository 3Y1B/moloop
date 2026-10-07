import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { RequestRow } from '@/components/guest/request-row';
import { DemoButton } from '@/components/demo-panel';
import { MapTopBar, useMapLayout } from '@/components/map/map-screen';
import { VenueMap } from '@/components/map/venue-map';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Card, Section, Separator } from '@/components/ui/card';
import { VoiceDock } from '@/components/voice/voice-dock';
import { useMyPlace, useMyRequests, useRepo } from '@/data/hooks';
import { nearestZone } from '@/lib/presence';
import { useTheme } from '@/hooks/use-theme';

/** Ask: the site with you on it and the assistant. Their requests in a sheet, once there are any. */
export default function AskScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const requests = useMyRequests();
  const layout = useMapLayout(150);
  const { height } = useWindowDimensions();
  const mine = useMyPlace();
  // Where the phone is. Without a fix on site, the AI reads the place from what they said.
  const here = mine ? nearestZone(mine) : null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <VenueMap
        route={null}
        me={mine}
        fit="route"
        frame={requests.length ? layout.frame : { ...layout.frame, bottom: layout.bottomInset / height }}
        style={StyleSheet.absoluteFill}
      />
      <MapTopBar top={layout.barTop} right={<DemoButton />} />

      {requests.length > 0 && (
        <BottomSheet detents={layout.detents} bottomInset={layout.bottomInset}>
          <Section title="Your requests">
            <Card>
              {requests.map((r, i) => (
                <Fragment key={r.request.id}>
                  {i > 0 && <Separator />}
                  <RequestRow view={r} />
                </Fragment>
              ))}
            </Card>
          </Section>
        </BottomSheet>
      )}

      <VoiceDock
        placeholder="Ask or report"
        onSend={async (text, clips) => {
          const id = await repo.guestAsk(text, here, null, clips);
          router.push({ pathname: '/request/[id]', params: { id } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
});

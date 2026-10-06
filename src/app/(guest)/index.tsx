import { router } from 'expo-router';
import { Fragment, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RequestRow } from '@/components/guest/request-row';
import { NEAR_ME, resolveZone, ZonePicker } from '@/components/guest/zone-picker';
import { MapButton } from '@/components/map/map-button';
import { MapTopBar, useMapLayout } from '@/components/map/map-screen';
import { VenueMap, zoneSpot } from '@/components/map/venue-map';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Card, Section, Separator } from '@/components/ui/card';
import { VoiceDock } from '@/components/voice/voice-dock';
import { Type } from '@/constants/theme';
import { useMyRequests, useRepo } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';

// Demo lines until real STT, one per hold: a report that sends someone, then a question the AI answers.
const LINES = [
  'hi um, my friend’s feeling really {busy|dizzy}, I think it’s the heat',
  'where can I, um, {fill|refill} my water bottle?',
];
const MORE = 'and we’re right by the big {tea|tree}';

/** Ask: the site with you on it, where you are, and the assistant. Their requests in the sheet. */
export default function AskScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const requests = useMyRequests();
  const [zone, setZone] = useState(NEAR_ME);
  const turn = useRef(0);
  const layout = useMapLayout(150);
  const here = resolveZone(zone);
  const at = zoneSpot(here);

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <VenueMap
        route={null}
        me={at}
        fit="route"
        frame={layout.frame}
        style={StyleSheet.absoluteFill}
      />
      <MapTopBar
        top={layout.barTop}
        right={repo.dev && <MapButton label="Demo controls" sf="slider.horizontal.3" md="tune" onPress={() => router.push('/dev')} />}
      />

      <BottomSheet detents={layout.detents} bottomInset={layout.bottomInset}>
        <View style={styles.where}>
          <Text style={[styles.title, { color: theme.text }]}>Where are you?</Text>
          <ZonePicker value={zone} onChange={setZone} />
        </View>

        {requests.length > 0 && (
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
        )}
      </BottomSheet>

      <VoiceDock
        placeholder="Ask or report"
        script={(before) => (before ? MORE : LINES[turn.current++ % LINES.length])}
        onSend={async (text) => {
          const id = await repo.guestAsk(text, here);
          router.push({ pathname: '/request/[id]', params: { id } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  where: { gap: 12 },
  title: { fontSize: Type.hero, fontWeight: '700', letterSpacing: -0.4 },
});

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { DemoButton } from '@/components/demo-panel';
import { goBack } from '@/components/guest/go-back';
import { RequestMap } from '@/components/guest/request-map';
import { StepTracker } from '@/components/guest/step-tracker';
import { Thread } from '@/components/guest/thread';
import { MapButton } from '@/components/map/map-button';
import { MapTopBar, useMapLayout } from '@/components/map/map-screen';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { VoiceDock } from '@/components/voice/voice-dock';
import { Radius, Type } from '@/constants/theme';
import { VENUE_ZONES } from '@/data/venue';
import { useLookups, useNow, useRepo, useRequest, type RequestView } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The "Uber" view: who's coming on the map, the status and steps on the sheet, and the assistant
 * at the bottom for anything that's changed. The AI decides whether a detail is a note or alerts the lead.
 */
export default function RequestScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const view = useRequest(id);
  const stage = view?.status.stage;
  const open = stage === 'finding' || stage === 'coming' || stage === 'with_you';
  const layout = useMapLayout(open ? 190 : 150, { dock: open });

  const top = (
    <MapTopBar
      top={layout.barTop}
      left={<MapButton label="Back" sf="chevron.left" md="chevron_left" onPress={goBack} />}
      right={<DemoButton />}
    />
  );

  if (!view) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        {top}
        <Text style={[styles.missing, { color: theme.textSecondary }]}>Request not found</Text>
      </View>
    );
  }

  const { request } = view;
  // While the answer has its own card, don't repeat it in the thread.
  const thread = stage === 'answered' ? request.thread.filter((e) => !(e.from === 'ai' && e.text === request.aiAnswer)) : request.thread;

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <RequestMap view={view} frame={layout.frame} />
      {top}

      <BottomSheet detents={layout.detents} bottomInset={layout.bottomInset}>
        <Hero view={view} />
        {stage === 'answered' && <Answer view={view} />}
        {open && <Help view={view} />}
        {stage === 'sorted' && <Sorted requestId={request.id} />}
        {stage === 'cancelled' && <Button label="New request" variant="tinted" onPress={goBack} />}
        {thread.length > 0 && (
          <Section title="Messages">
            <Thread entries={thread} />
          </Section>
        )}
        {open && <CancelRequest requestId={request.id} />}
      </BottomSheet>

      {open && (
        <VoiceDock
          placeholder="Add detail"
          onSend={async (text) => ((await repo.guestAddDetail(request.id, text)).escalated ? 'Lead alerted.' : 'Note added.')}
        />
      )}
    </View>
  );
}

/** The one line that matters, big, with the minutes boxed when someone's on the way. Then the steps. */
function Hero({ view }: { view: RequestView }) {
  const theme = useTheme();
  const now = useNow();
  const { status, request } = view;
  const matched = status.stage === 'finding' && !!status.volunteerId;
  const waiting = status.stage === 'understanding' || (status.stage === 'finding' && !matched);
  const mins = status.stage === 'coming' && status.arriveAt ? Math.max(1, Math.ceil((status.arriveAt - now) / 60_000)) : null;
  // lib/status writes "Ben is coming · 3 min"; the minutes move into the box.
  const title = mins != null ? status.label.split(' · ')[0] : `${status.label}${waiting ? '…' : ''}`;
  return (
    <View style={styles.hero}>
      <View style={styles.heroRow}>
        <Animated.Text key={title} entering={FadeIn.duration(220)} style={[styles.status, { color: theme.text }]}>
          {title}
        </Animated.Text>
        {mins != null && (
          <View style={[styles.mins, { backgroundColor: theme.text }]}>
            <Text style={[styles.minsNumber, { color: theme.background }]}>{mins}</Text>
            <Text style={[styles.minsUnit, { color: theme.background }]}>min</Text>
          </View>
        )}
      </View>
      {!!status.detail && <Text style={[styles.detail, { color: theme.textSecondary }]}>{status.detail}</Text>}
      <StepTracker stage={status.stage} reached={request.taskId || request.aiAnswer ? 2 : 1} matched={matched} />
    </View>
  );
}

/** AI answered: the answer, and a way to a person if it didn't do it. */
function Answer({ view }: { view: RequestView }) {
  const theme = useTheme();
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.answer, { backgroundColor: theme.backgroundElement }]}>
      <Text style={[styles.answerText, { color: theme.text }]} selectable>{view.request.aiAnswer}</Text>
      <Button
        label="Talk to a person"
        sf="person.fill"
        variant="tinted"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await repo.guestRequestHuman(view.request.id);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Animated.View>
  );
}

/** Who's coming and where they're coming to. */
function Help({ view }: { view: RequestView }) {
  const theme = useTheme();
  const { teams } = useLookups();
  const { request, task, status, volunteer } = view;
  const team = volunteer?.teamSlug ? teams[volunteer.teamSlug] : undefined;
  // Matched but not walking over yet: say where they are, as their dot on the map does.
  const at = status.stage === 'finding' && volunteer?.zoneSlug ? VENUE_ZONES[volunteer.zoneSlug]?.label : null;
  const about = [team?.name, at].filter(Boolean).join(' · ');
  const zone = request.zoneSlug ?? task?.zoneSlug;
  const where = [zone ? VENUE_ZONES[zone]?.label : null, request.locationHint].filter(Boolean).join(' · ');

  return (
    <View style={styles.help}>
      {volunteer && (
        <View style={styles.row}>
          <Avatar name={volunteer.name} color={team?.color} size={44} />
          <View style={styles.flex}>
            <Text style={[styles.name, { color: theme.text }]}>{volunteer.name.split(' ')[0]}</Text>
            {!!about && <Text style={[styles.sub, { color: theme.textSecondary }]}>{about}</Text>}
          </View>
        </View>
      )}
      <View style={styles.row}>
        <View style={[styles.pinBox, { backgroundColor: `${theme.tint}14` }]}>
          <Icon sf="location.fill" md="location_on" size={15} color={theme.tint} />
        </View>
        <View style={styles.flex}>
          {!!where && <Text style={[styles.where, { color: theme.text }]}>{where}</Text>}
          <Text style={[styles.sub, { color: theme.textSecondary }]}>Sharing location</Text>
        </View>
      </View>
    </View>
  );
}

/** Quiet, at the very end, with a second tap to be sure. */
function CancelRequest({ requestId }: { requestId: string }) {
  const theme = useTheme();
  const repo = useRepo();
  const [sure, setSure] = useState(false);
  return sure ? (
    <View style={styles.actions}>
      <Button label="Keep request" variant="tinted" color={theme.textSecondary} onPress={() => setSure(false)} style={styles.flex} />
      <Button label="Cancel request" color={theme.danger} haptic="warning" onPress={() => repo.guestCancel(requestId)} style={styles.flex} />
    </View>
  ) : (
    <Button label="Cancel request" variant="plain" color={theme.danger} onPress={() => setSure(true)} />
  );
}

/** Sorted: Done is the expected tap; reopening is there to catch a request closed too early. No rating. */
function Sorted({ requestId }: { requestId: string }) {
  const theme = useTheme();
  const repo = useRepo();
  return (
    <View style={styles.actions}>
      <Button label="Still need help" variant="tinted" color={theme.textSecondary} onPress={() => repo.guestReopen(requestId)} style={styles.flex} />
      <Button label="Done" haptic="success" onPress={goBack} style={styles.flex} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The sheet hangs below the screen at its lower stops; on the web that must not make the page scroll.
  screen: { flex: 1, overflow: 'hidden' },
  missing: { fontSize: Type.body, textAlign: 'center', marginTop: 160 },
  hero: { gap: 18 },
  detail: { fontSize: Type.body, marginTop: -12 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { flex: 1, fontSize: Type.hero + 2, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 },
  mins: { width: 60, height: 60, borderRadius: Radius.control, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  minsNumber: { fontSize: Type.hero + 2, fontWeight: '700', fontVariant: ['tabular-nums'], lineHeight: 26 },
  minsUnit: { fontSize: Type.caption, fontWeight: '600' },
  answer: { padding: 16, gap: 14, borderRadius: Radius.card, borderCurve: 'continuous' },
  answerText: { fontSize: Type.body + 2, lineHeight: 24 },
  help: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pinBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: Type.title - 1, fontWeight: '600' },
  sub: { fontSize: Type.footnote },
  where: { fontSize: Type.body, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8 },
});

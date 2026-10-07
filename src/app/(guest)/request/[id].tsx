import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { DemoButton } from '@/components/demo-panel';
import { RequestMap } from '@/components/guest/request-map';
import { STEP_TRACKER_HEIGHT, StepTracker } from '@/components/guest/step-tracker';
import { Thread } from '@/components/guest/thread';
import { MapButton } from '@/components/map/map-button';
import { useMapLayout } from '@/components/map/map-screen';
import { BottomSheet, GRABBER_HEIGHT } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PressableOpacity } from '@/components/ui/pressable';
import { Text, textStyle } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { VoiceDock } from '@/components/voice/voice-dock';
import { Radius, Spacing, Type } from '@/constants/theme';
import { VENUE_ZONES } from '@/data/venue';
import { useLookups, useNow, useRepo, useRequest, type RequestView } from '@/data/hooks';
import { goBack } from '@/lib/navigation';
import type { GuestThreadEntry } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const MIN = 60_000;
const PLACEHOLDER = 'What’s changed?';
/** How long each waiting stage usually takes, so its segment fills on time without pretending to finish. */
const EXPECT: Partial<Record<string, number>> = { understanding: 8_000, finding: 45_000 };

/** Sheet peek pieces, in px: status line, minutes box, detail line, who row, action row (plus the grabber). */
const LINE = 32;
const MINS = 64;
const DETAIL = 22;
const WHO = 44;
const ACTION = 48;

/** Back to Ask, which is where a request page opened straight from a link goes too. */
const back = () => goBack('/(guest)');

/**
 * Who's coming on the map; the sheet's peek is the whole answer (status, minutes, the steps line, who). The
 * assistant sits at the bottom for anything that's changed: the AI decides whether it's a note or alerts the lead.
 */
export default function RequestScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const now = useNow();
  const { height } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const view = useRequest(id);
  // "Problem solved?" No: the box comes back to say more, until the next answer or ×. Keyed by the thread's length,
  // so a new answer arriving puts the question back on its own.
  const [moreAt, setMoreAt] = useState<number | null>(null);

  const stage = view?.status.stage;
  const open = stage === 'finding' || stage === 'coming' || stage === 'with_you';
  const answered = stage === 'answered';
  const more = answered && moreAt === view?.request.thread.length;
  const dock = open || stage === 'understanding' || more;
  const chat = view && answered ? splitAnswer(view.request.thread, view.request.aiAnswer) : null;

  const peek = view ? peekHeight(view, now) : 0;
  const layout = useMapLayout(peek, { dock });
  // Rest at the peek; the answer opens halfway, or all the way once there's history above it.
  const stop = answered ? (chat?.history.length ? 2 : 1) : 0;
  const frame = { top: layout.frame.top, bottom: layout.detents[Math.min(stop, 1)] / height };

  const top = (
    <TopBar
      variant="floating"
      left={<MapButton label="Back" sf="chevron.left" md="chevron_left" onPress={back} />}
      right={<DemoButton />}
    />
  );

  if (!view) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        {top}
        <EmptyState title="Request not found" variant="screen" style={styles.missing} />
      </View>
    );
  }

  const { request } = view;

  return (
    <View style={[styles.screen, { backgroundColor: theme.mapGround }]}>
      <RequestMap view={view} frame={frame} />
      {top}

      <BottomSheet
        detents={layout.detents}
        stop={stop}
        bottomInset={layout.bottomInset}
        // A first answer rests at the middle stop with the map above it; later messages open it all the way.
        raise={answered && !chat?.history.length ? 0 : request.thread.filter((e) => e.from !== 'guest').length}>
        <Hero view={view} />
        {chat && (
          <Answer
            chat={chat}
            requestId={request.id}
            asking={!more}
            onNo={() => setMoreAt(request.thread.length)}
          />
        )}
        {stage === 'sorted' && <Sorted requestId={request.id} />}
        {stage === 'cancelled' && <Button label="New request" size="large" onPress={back} style={styles.block} />}
        {!answered && request.thread.length > 0 && (
          <View style={[styles.thread, { borderTopColor: theme.separator }]}>
            <Thread entries={request.thread} />
          </View>
        )}
        {open && <CancelRequest requestId={request.id} />}
      </BottomSheet>

      {more ? (
        <VoiceDock
          key="more"
          placeholder={PLACEHOLDER}
          onSend={(text) => repo.guestFollowUp(request.id, text)}
          onDismiss={() => setMoreAt(null)}
        />
      ) : dock ? (
        <VoiceDock
          placeholder={PLACEHOLDER}
          onSend={async (text) => {
            // Nobody sent yet: back to the AI, which answers again or sends someone.
            if (!open) return repo.guestFollowUp(request.id, text);
            return (await repo.guestAddDetail(request.id, text)).escalated ? 'Lead alerted.' : 'Note added.';
          }}
        />
      ) : null}
    </View>
  );
}

/** Minutes left on the walk, once someone's on the way. */
function minutesLeft(view: RequestView, now: number) {
  const { status } = view;
  return status.stage === 'coming' && status.arriveAt ? Math.max(1, Math.ceil((status.arriveAt - now) / MIN)) : null;
}

/** Rough height of the peek: the hero, who's coming, and the one action when it's over. */
function peekHeight(view: RequestView, now: number) {
  const { status, volunteer } = view;
  const text = LINE + (status.detail ? DETAIL : 0);
  const hero = Math.max(minutesLeft(view, now) != null ? MINS : 0, text) + Spacing.four + STEP_TRACKER_HEIGHT;
  const who = volunteer && status.stage !== 'sorted' ? Spacing.four + WHO : 0;
  const action = status.stage === 'sorted' || status.stage === 'cancelled' ? Spacing.four + ACTION : 0;
  return GRABBER_HEIGHT + hero + who + action + Spacing.four;
}

/** How far into the live step: the walk while coming, else the clock against how long that stage usually takes. */
function liveFraction(view: RequestView, now: number, matched: boolean) {
  const { status, task, request } = view;
  if (status.stage === 'coming') {
    const start = task?.assignedAt ?? task?.createdAt ?? now;
    const span = (status.arriveAt ?? now) - start;
    return span > 0 ? (now - start) / span : 1;
  }
  if (matched) return 0.15;
  const expect = EXPECT[status.stage];
  if (!expect) return 1;
  const asked = request.thread.findLast((e) => e.from === 'guest')?.at ?? request.createdAt;
  const since = status.stage === 'finding' ? task?.createdAt ?? asked : asked;
  return Math.min(0.9, Math.max(0.05, (now - since) / expect));
}

/** Status, boxed minutes, the steps line, then who. The peek. */
function Hero({ view }: { view: RequestView }) {
  const theme = useTheme();
  const now = useNow();
  const { status, request, volunteer } = view;
  const matched = status.stage === 'finding' && !!status.volunteerId;
  const waiting = status.stage === 'understanding' || (status.stage === 'finding' && !matched);
  const mins = minutesLeft(view, now);
  // lib/status writes "Ben is coming · 3 min"; the minutes move into the box.
  const title = mins != null ? status.label.split(' · ')[0] : `${status.label}${waiting ? '…' : ''}`;

  return (
    <View style={styles.hero}>
      <View style={styles.heroRow}>
        <View style={styles.flex}>
          <Animated.Text
            key={title}
            entering={FadeIn.duration(200)}
            style={[styles.status, { color: status.stage === 'sorted' ? theme.success : theme.text }]}>
            {title}
          </Animated.Text>
          {!!status.detail && <Text tone="secondary">{status.detail}</Text>}
        </View>
        {mins != null && (
          <View style={[styles.mins, { backgroundColor: theme.tintSoft }]}>
            <Text tone="tint" style={styles.minsNumber}>{mins}</Text>
            <Text variant="label" tone="tint">min</Text>
          </View>
        )}
      </View>
      <StepTracker
        stage={status.stage}
        reached={request.taskId || request.aiAnswer ? 2 : 1}
        matched={matched}
        live={liveFraction(view, now, matched)}
      />
      {volunteer && status.stage !== 'sorted' && <Who view={view} />}
    </View>
  );
}

/** Who's coming: their initial in the accent (their dot on the map), name and team. Once they're on the way, the finder. */
function Who({ view }: { view: RequestView }) {
  const theme = useTheme();
  const { teams } = useLookups();
  const { request, status, volunteer } = view;
  if (!volunteer) return null;
  const team = volunteer.teamSlug ? teams[volunteer.teamSlug] : undefined;
  // Matched but not walking over yet: say where they are, as their dot on the map does.
  const at = status.stage === 'finding' && volunteer.zoneSlug ? VENUE_ZONES[volunteer.zoneSlug]?.label : null;
  const about = [team?.name, at].filter(Boolean).join(' · ');
  const [first, last] = volunteer.name.split(' ');
  const findable = !!request.taskId && (status.stage === 'coming' || status.stage === 'with_you');

  return (
    <View style={styles.who}>
      <View style={[styles.disc, { borderColor: theme.tint }]}>
        <Text variant="section" tone="tint">{volunteer.name[0]}</Text>
      </View>
      <View style={styles.flex}>
        <Text variant="section">{last ? `${first} ${last[0]}.` : first}</Text>
        {!!about && <Text tone="secondary">{about}</Text>}
      </View>
      {/* Both phones can run the finder for the last few metres. */}
      {findable && (
        <Button
          label="Find"
          sf="dot.radiowaves.left.and.right"
          size="small"
          variant="secondary"
          onPress={() => router.push({ pathname: '/find/[id]', params: { id: request.taskId!, name: first } })}
        />
      )}
    </View>
  );
}

type Chat = { history: GuestThreadEntry[]; query: GuestThreadEntry[]; answer: string };

/**
 * The latest answer and what it answered; everything before is history. The answer is the last AI line in the
 * thread, the query is the guest's lines just before it.
 */
function splitAnswer(thread: GuestThreadEntry[], aiAnswer: string | null): Chat {
  let end = thread.findLastIndex((e) => e.from === 'ai');
  if (end < 0) end = thread.length;
  let start = end;
  while (start > 0 && thread[start - 1].from === 'guest') start--;
  return { history: thread.slice(0, start), query: thread.slice(start, end), answer: aiAnswer ?? thread[end]?.text ?? '' };
}

/**
 * Earlier questions and answers as a thread, then the latest question above its answer, then "Problem solved?".
 * No brings the box back to say more (× puts the question back); Yes closes it.
 */
function Answer({ chat, requestId, asking, onNo }: { chat: Chat; requestId: string; asking: boolean; onNo: () => void }) {
  const theme = useTheme();
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.block}>
      {chat.history.length > 0 && (
        <View style={[styles.history, { borderBottomColor: theme.separator }]}>
          <Thread entries={chat.history} />
        </View>
      )}
      <Animated.View key={chat.answer} entering={FadeIn.duration(220)} style={styles.qa}>
        {chat.query.map((q, i) => (
          <Text key={`${q.at}-${i}`} tone="secondary" selectable>{q.text}</Text>
        ))}
        <Text style={styles.answer} selectable>{chat.answer}</Text>
      </Animated.View>
      {asking && (
        <View style={styles.solved}>
          <Text variant="section">Problem solved?</Text>
          <View style={styles.row}>
            <Button
              label="No"
              size="large"
              variant="secondary"
              disabled={busy}
              onPress={onNo}
              style={styles.flex}
            />
            <Button
              label="Yes"
              size="large"
              haptic="success"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await repo.guestSolved(requestId);
                  back();
                } finally {
                  setBusy(false);
                }
              }}
              style={styles.flex}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** Quiet, at the very end, with a second tap to be sure. */
function CancelRequest({ requestId }: { requestId: string }) {
  const repo = useRepo();
  const [sure, setSure] = useState(false);
  return sure ? (
    <View style={[styles.block, styles.row]}>
      <Button label="Keep" size="large" variant="secondary" onPress={() => setSure(false)} style={styles.flex} />
      <Button label="Cancel request" size="large" tone="danger" haptic="warning" onPress={() => repo.guestCancel(requestId)} style={styles.flex} />
    </View>
  ) : (
    <PressableOpacity accessibilityRole="button" onPress={() => setSure(true)} style={styles.quiet}>
      <Text tone="danger">Cancel request</Text>
    </PressableOpacity>
  );
}

/** Sorted: Done is the expected tap; reopening is there to catch a request closed too early. No rating. */
function Sorted({ requestId }: { requestId: string }) {
  const repo = useRepo();
  return (
    <View style={[styles.block, styles.row]}>
      <Button
        label="Still need help?"
        size="large"
        variant="secondary"
        onPress={() => repo.guestReopen(requestId)}
        style={styles.flex}
      />
      <Button label="Done" size="large" haptic="success" onPress={back} style={styles.flex} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The sheet hangs below the screen at its lower stops; on the web that must not make the page scroll.
  screen: { flex: 1, overflow: 'hidden' },
  missing: { marginTop: 160 },
  hero: { gap: Spacing.four },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  status: { fontSize: Type.hero + 4, lineHeight: LINE, fontWeight: '600', letterSpacing: -0.6 },
  mins: { width: MINS, height: MINS, borderRadius: Radius.card, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  minsNumber: { fontSize: Type.hero + 4, lineHeight: 30, fontWeight: '600', fontVariant: ['tabular-nums'] },
  who: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  disc: { width: WHO, height: WHO, borderRadius: WHO / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  answer: { ...textStyle('body'), fontSize: Type.headline, lineHeight: 25 },
  block: { gap: Spacing.three, marginTop: Spacing.two },
  history: { paddingBottom: Spacing.four, borderBottomWidth: StyleSheet.hairlineWidth },
  qa: { gap: Spacing.two },
  solved: { gap: Spacing.three, paddingTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  thread: { marginTop: Spacing.three, paddingTop: Spacing.four, borderTopWidth: StyleSheet.hairlineWidth },
  quiet: { paddingVertical: Spacing.four, alignItems: 'center' },
});

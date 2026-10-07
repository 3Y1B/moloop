import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { getFinderOpen, listenForRing, subscribeFinderOpen } from '@/data/finder-ring';
import { useMyPlace, useMyRequests, useMyWork, usePlaceOf, useSnapshot } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { isClose } from '@/lib/finder';

/*
 * The finder needs both phones on, so the other person gets asked. Two prompts, one banner at the top:
 *  - ring: the other person opened Find ("Priya turned on Find").
 *  - close: GPS has the two of you within ~30 m, close enough for Bluetooth to take over. Both phones work this
 *    out from the same two positions, so both get it at about the same time.
 * Neither shows while the finder for that task is already open.
 */

type Prompt = { kind: 'ring' | 'close'; taskId: string; name: string | null };

/** Long enough to read and reach for; it isn't an alarm. */
const SHOW_MS = 15_000;

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** Who I'd be finding right now, on which task: the volunteer coming to me, or the festival-goer I'm going to. */
function useFinderPair() {
  const s = useSnapshot();
  const requests = useMyRequests();
  const { active } = useMyWork();
  const guest = !!s.meId && s.meId === s.guestId;

  if (guest) {
    const coming = requests.find((r) => r.request.taskId && r.volunteer && (r.status.stage === 'coming' || r.status.stage === 'with_you'));
    if (!coming) return null;
    return { taskId: coming.request.taskId!, name: firstName(coming.volunteer!.name), peerId: coming.volunteer!.id, walking: true };
  }
  if (!active?.requestId) return null;
  return {
    taskId: active.id,
    name: firstName(active.reporter.name),
    peerId: s.requests[active.requestId]?.guestId ?? null,
    // Assigned but not accepted: they aren't on their way, so being near is chance, not a meeting.
    walking: active.status === 'accepted' || active.status === 'in_progress',
  };
}

export function FinderPrompt() {
  const pair = useFinderPair();
  const taskId = pair?.taskId ?? null;
  const name = pair?.name ?? null;
  const open = useSyncExternalStore(subscribeFinderOpen, getFinderOpen);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const show = useCallback((kind: Prompt['kind'], id: string, who: string | null) => {
    if (getFinderOpen() === id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setPrompt({ kind, taskId: id, name: who });
  }, []);

  // The other phone opened Find.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    if (!taskId) return;
    return listenForRing(taskId, () => show('ring', taskId, nameRef.current));
  }, [taskId, show]);

  // We've come within range of each other.
  const me = useMyPlace();
  const them = usePlaceOf(pair?.peerId);
  const theirs = them && !them.stale ? them.at : null;
  const wasClose = useRef<{ taskId: string | null; close: boolean }>({ taskId: null, close: false });
  const walking = !!pair?.walking;
  useEffect(() => {
    if (!taskId || !walking) return;
    const was = wasClose.current.taskId === taskId && wasClose.current.close;
    const close = isClose(me, theirs, was);
    wasClose.current = { taskId, close };
    if (close && !was) show('close', taskId, nameRef.current);
    // Positions by value: a new snapshot with the same place isn't a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, walking, me?.x, me?.y, theirs?.x, theirs?.y, show]);

  // Gone once it's answered, timed out, or the task it's about is over.
  useEffect(() => {
    if (!prompt) return;
    const timer = setTimeout(() => setPrompt(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [prompt]);
  const visible = prompt && prompt.taskId === taskId && open !== prompt.taskId ? prompt : null;

  if (!visible) return null;
  return (
    <Banner
      key={`${visible.kind}:${visible.taskId}`}
      prompt={visible}
      onFind={() => {
        setPrompt(null);
        router.push({ pathname: '/find/[id]', params: { id: visible.taskId, name: visible.name ?? undefined } });
      }}
      onDismiss={() => setPrompt(null)}
    />
  );
}

function Banner({ prompt, onFind, onDismiss }: { prompt: Prompt; onFind: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { kind, name } = prompt;
  const title =
    kind === 'ring' ? (name ? `${name} turned on Find` : 'They’re looking for you')
      : name ? `You’re close to ${name}` : 'You’re close';
  const body = kind === 'ring' ? 'Turn yours on so your phones find each other.' : 'Use Find to spot them in the crowd.';

  return (
    <Animated.View
      entering={SlideInUp.springify().damping(18)}
      exiting={FadeOutUp.duration(160)}
      style={[styles.wrap, { top: insets.top + 8 }]}
      pointerEvents="box-none">
      <View
        accessibilityRole="alert"
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
          <Icon sf="dot.radiowaves.left.and.right" md="sensors" size={18} color={theme.tint} weight="semibold" />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]} numberOfLines={2}>{body}</Text>
        </View>
        <Button label="Find" size="small" onPress={onFind} />
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" hitSlop={10} onPress={onDismiss} style={styles.close}>
          <Icon sf="xmark" md="close" size={12} color={theme.textTertiary} weight="bold" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { fontSize: Type.body, fontWeight: '600' },
  body: { fontSize: Type.footnote },
  close: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});

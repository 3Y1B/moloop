import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DUTY_CHIP_HEIGHT, DutyChip, DutyPanel } from '@/components/duty-header';
import { ActiveTaskCard } from '@/components/task/active-task-card';
import { AllClear } from '@/components/task/all-clear';
import { TaskRow } from '@/components/task/task-row';
import { Button } from '@/components/ui/button';
import { Canvas } from '@/components/ui/canvas';
import { Card, Separator } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { GradientWords } from '@/components/voice/gradient-words';
import { Orb } from '@/components/voice/orb';
import { BottomTabInset, Radius, Type } from '@/constants/theme';
import { useMe, useMyWork, useRepo } from '@/data/hooks';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function MyTaskScreen() {
  const { active, queue, done } = useMyWork();
  const scroll = useRef<ScrollView>(null);
  // Scroll offset when the shift panel opened (null = closed), so the overlay lines up under the chip.
  const [dutyAt, setDutyAt] = useState<number | null>(null);
  const scrollY = useRef(0);
  const insets = useSafeAreaInsets();

  // A new active task (assigned, or promoted from the queue) should never arrive off-screen.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: true });
  }, [active?.id]);

  return (
    <View style={styles.flex}>
      <Canvas />
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={32}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        onScrollBeginDrag={() => setDutyAt(null)}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + BottomTabInset + 24 }]}>
        <View style={styles.header}>
          <DutyChip open={dutyAt != null} onToggle={() => setDutyAt((at) => (at == null ? scrollY.current : null))} />
          <TalkPill />
        </View>

        <Animated.View layout={LinearTransition.duration(220)} style={styles.stack}>
          {active ? <ActiveTaskCard key={active.id} task={active} /> : <FreeCard />}

          {queue.length > 0 && (
            <Group title="Up next" count={queue.length}>
              <TaskList tasks={queue} />
            </Group>
          )}

          {done.length > 0 && <DoneGroup tasks={done} />}
        </Animated.View>
      </ScrollView>

      {dutyAt != null && (
        <>
          <AnimatedPressable
            accessibilityLabel="Close shift details"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(140)}
            style={[StyleSheet.absoluteFill, styles.scrim]}
            onPress={() => setDutyAt(null)}
          />
          <DutyPanel style={[styles.dutyOverlay, { top: insets.top + 6 + DUTY_CHIP_HEIGHT + 8 - dutyAt }]} />
        </>
      )}
    </View>
  );
}

/** The assistant lives in the header: tap the orb to talk. */
function TalkPill() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Talk to Moloop"
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.navigate('/talk');
      }}
      style={({ pressed }) => [styles.talk, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.talkText, { color: theme.textSecondary }]}>Talk</Text>
      <Orb size={30} ring={false} />
    </Pressable>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <GroupPill title={title} count={count} />
      {children}
    </View>
  );
}

/** Section label as a small pill: name, then the count in its own bubble. */
function GroupPill({ title, count, trailing }: { title: string; count: number; trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.groupPill, { backgroundColor: theme.card, borderColor: theme.border, paddingRight: trailing ? 9 : 4 }]}>
      <Text style={[styles.groupTitle, { color: theme.text }]}>{title}</Text>
      <View style={[styles.groupCount, { backgroundColor: theme.backgroundSelected }]}>
        <Text style={[styles.groupCountText, { color: theme.textSecondary }]}>{count}</Text>
      </View>
      {trailing}
    </View>
  );
}

function DoneGroup({ tasks }: { tasks: Task[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        style={({ pressed }) => [styles.groupToggle, { opacity: pressed ? 0.6 : 1 }]}>
        <GroupPill
          title="Done this shift"
          count={tasks.length}
          trailing={<Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={9} color={theme.textTertiary} weight="semibold" />}
        />
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(180)}>
          <TaskList tasks={tasks} />
        </Animated.View>
      )}
    </View>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <Card>
      {tasks.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <Separator inset={34} />}
          <TaskRow task={t} />
        </Fragment>
      ))}
    </Card>
  );
}

function FreeCard() {
  const theme = useTheme();
  const repo = useRepo();
  const me = useMe();
  const onBreak = me?.duty !== 'on_duty';

  return (
    <View style={styles.free}>
      <AllClear onBreak={onBreak} />
      <GradientWords
        text={onBreak ? 'On break. Drink some water.' : 'You’re free. New tasks will be read out to you.'}
        lead={2}
        style={[styles.freeTitle, { color: theme.text }]}
      />
      <Text style={[styles.freeBody, { color: theme.textSecondary }]}>
        {onBreak ? 'No new tasks will come to you.' : 'Keep your headphones in. Tap Talk to report something.'}
      </Text>
      {onBreak && (
        <Button label="Back on duty" sf="figure.walk" variant="tinted" color={theme.success} onPress={() => repo.setDuty('on_duty')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dutyOverlay: { position: 'absolute', left: 16, right: 16 },
  scrim: { backgroundColor: 'rgba(17, 24, 39, 0.04)' },
  stack: { gap: 16, marginTop: 2 },
  talk: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: DUTY_CHIP_HEIGHT, paddingLeft: 14, paddingRight: 4,
    borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth * 2,
  },
  talkText: { fontSize: Type.footnote, fontWeight: '600' },
  group: { gap: 6 },
  groupToggle: { alignSelf: 'flex-start' },
  groupPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 28,
    paddingLeft: 11, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth * 2,
  },
  groupTitle: { fontSize: Type.footnote - 1, fontWeight: '500' },
  groupCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  groupCountText: { fontSize: Type.caption - 1, fontWeight: '600', fontVariant: ['tabular-nums'] },
  free: { alignItems: 'center', paddingTop: 12, paddingBottom: 28, paddingHorizontal: 12, gap: 10 },
  freeTitle: { fontSize: Type.hero - 2, lineHeight: 26, fontWeight: '600', textAlign: 'center', letterSpacing: -0.3, marginTop: 4 },
  freeBody: { fontSize: Type.callout, lineHeight: 20, textAlign: 'center' },
});

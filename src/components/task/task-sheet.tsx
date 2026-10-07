import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Type } from '@/constants/theme';
import { useLookups, useMe, useRouteTo, useSnapshot, useTaskEvents, useTaskStatus } from '@/data/hooks';
import { clockTime, languageName } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { taskStatusFor } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';
import { Owner } from './active-task-card';
import { Head, LogLines, LogSheet, NowLine, type LogEntry } from './task-log';

type SheetProps = {
  /** The head's height, so the collapsed sheet shows exactly it. */
  onHeadLayout?: (height: number) => void;
  /** What's visible at the resting stop; the log fills it from the bottom. */
  minHeight?: number;
};

/**
 * My task as a running log. The head is what and where (all the collapsed sheet shows); under it, the reporter's
 * words, Moloop's read, then every change, oldest first; the status is the last line, set large. The replies are
 * pinned under the sheet (TaskActions), the voice field under them.
 */
export function TaskSheet({ task, onHeadLayout, minHeight }: { task: Task } & SheetProps) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  const route = useRouteTo(task);
  const events = useTaskEvents(task.id);
  const { meId } = useSnapshot();
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;
  const helping = !!meId && task.helperIds.includes(meId);
  const hint = task.locationHint ? task.locationHint.charAt(0).toLowerCase() + task.locationHint.slice(1) : null;
  // The hint only when it adds something: "Water 2, by the second tap", not "Water 2, water 2".
  const extra = hint && hint.toLowerCase() !== zone?.name.toLowerCase() ? hint : null;
  const place = zone ? (extra ? `${zone.name}, ${extra}` : zone.name) : task.locationHint;

  const entries = useMemo((): LogEntry[] => {
    const r = task.reporter;
    const by = r.name ?? (r.kind === 'festivalgoer' ? 'Festival-goer' : 'Reporter');
    return [
      {
        id: 'quote',
        at: task.createdAt,
        who: r.language !== 'en' ? `${by} · translated from ${languageName(r.language)}` : by,
        text: `“${r.quote}”`,
        quote: true,
      },
      { id: 'summary', at: task.createdAt, who: 'Moloop', text: task.summary },
      ...events
        .filter((e) => e.kind !== 'created')
        .map((e): LogEntry => ({ id: e.id, at: e.at, text: e.text, note: e.note })),
    ];
  }, [task.createdAt, task.reporter, task.summary, events]);

  return (
    <Animated.View key={task.id} entering={FadeIn.duration(220)}>
      <LogSheet
        onHeadLayout={onHeadLayout}
        minHeight={minHeight}
        head={
          <>
            <Head title={task.title}>
              <View style={styles.where}>
                <Text style={[styles.text, styles.flex, { color: theme.textSecondary }]} numberOfLines={1}>{place}</Text>
                {route && (
                  <Text style={[styles.text, styles.minutes, { color: theme.textSecondary }]}>
                    {route.here ? 'You’re here' : `${route.minutes} min`}
                  </Text>
                )}
                {route && !route.here && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${route.minutes} minute walk. Directions`}
                    hitSlop={10}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push({ pathname: '/navigate/[id]', params: { id: task.id } });
                    }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <Text style={[styles.text, styles.strong, { color: theme.tint }]}>Directions</Text>
                  </Pressable>
                )}
              </View>
            </Head>
            {helping && (
              <View style={styles.owner}>
                <Owner task={task} />
              </View>
            )}
          </>
        }>
        <LogLines id={task.id} entries={entries} />
        {status && <NowLine status={status} />}
      </LogSheet>
    </Animated.View>
  );
}

/**
 * No task: the head says so; the log is the shift so far, each finished task one line (tap for its page).
 * Done tasks come newest first; the log reads oldest first.
 */
export function FreeSheet({ done, onHeadLayout, minHeight }: { done: Task[] } & SheetProps) {
  const theme = useTheme();
  const me = useMe();
  const { teams } = useLookups();
  const onBreak = me?.duty !== 'on_duty';
  const team = me?.teamSlug ? teams[me.teamSlug] : undefined;
  const sub = [team?.name, me?.shiftEndsAt ? `until ${clockTime(me.shiftEndsAt)}` : null].filter(Boolean).join(' · ');
  const snapshot = useSnapshot();
  const entries = [...done].reverse().map((t): LogEntry => ({
    id: t.id,
    at: t.resolvedAt ?? t.lastActivityAt,
    // How it ended, as the status says it ("Done", "Handed to medics").
    text: `${taskStatusFor(snapshot.meId, t, snapshot, snapshot.now).label} · ${t.title}`,
    onPress: () => router.push({ pathname: '/task/[id]', params: { id: t.id } }),
  }));

  return (
    <LogSheet
      onHeadLayout={onHeadLayout}
      minHeight={minHeight}
      head={
        <Head title={onBreak ? 'On break' : 'Free'}>
          {!!sub && <Text style={[styles.text, { color: theme.textSecondary }]} numberOfLines={1}>{sub}</Text>}
        </Head>
      }>
      <LogLines id="shift" entries={entries} />
    </LogSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { fontSize: Type.body, lineHeight: 21 },
  strong: { fontWeight: '600' },
  minutes: { fontVariant: ['tabular-nums'] },
  owner: { marginTop: 10 },
});

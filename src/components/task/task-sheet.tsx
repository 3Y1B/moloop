import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useLookups, useMe, useRouteTo, useSnapshot, useTaskEvents, useTaskStatus } from '@/data/hooks';
import { clockTime } from '@/lib/format';
import { confirmedPeopleCount } from '@/lib/lifecycle';
import { quoteFor } from '@/lib/quote';
import type { Task } from '@/lib/schema';
import { taskStatusFor } from '@/lib/status';
import { useTheme } from '@/hooks/use-theme';
import { Owner } from './owner';
import { PrioritySignal } from './badges';
import { eventEntry, Head, LogLines, LogSheet, NowLine, type LogEntry } from './task-log';

type SheetProps = {
  /** The head's height, so the collapsed sheet shows exactly it. */
  onHeadLayout?: (height: number) => void;
  /** What's visible at the resting stop; the log fills it from the bottom. */
  minHeight?: number;
  /** The sheet is open all the way: the whole log. */
  expanded?: boolean;
  /** "Show earlier": open the sheet. */
  onExpand?: () => void;
};

/**
 * My task as a running log. The head is what and where (all the collapsed sheet shows); under it, the reporter's
 * words, Moloop's read, then every change, oldest first; the status is the last line, set large. The replies are
 * pinned under the sheet (TaskActions), the voice field under them.
 */
export function TaskSheet({ task, onHeadLayout, minHeight, expanded, onExpand }: { task: Task } & SheetProps) {
  const theme = useTheme();
  const status = useTaskStatus(task);
  const route = useRouteTo(task);
  const events = useTaskEvents(task.id);
  const { meId } = useSnapshot();
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;
  const helping = !!meId && task.helpers.some((helper) => helper.volunteerId === meId);
  const hint = task.locationHint ? task.locationHint.charAt(0).toLowerCase() + task.locationHint.slice(1) : null;
  // The hint only when it adds something: "Water 2, by the second tap", not "Water 2, water 2".
  const extra = hint && hint.toLowerCase() !== zone?.name.toLowerCase() ? hint : null;
  const place = zone ? (extra ? `${zone.name}, ${extra}` : zone.name) : task.locationHint;

  // English first; a tap on a translated quote shows what they actually said, and another tap goes back.
  const [original, setOriginal] = useState(false);
  const entries = useMemo((): LogEntry[] => {
    const r = task.reporter;
    const by = r.name ?? (r.kind === 'festivalgoer' ? 'Festival-goer' : 'Reporter');
    const q = quoteFor(r);
    const shown = original && q.original ? q.original : { text: q.text, label: q.label };
    return [
      {
        id: 'quote',
        at: task.createdAt,
        who: shown.label ? `${by} · ${shown.label}` : by,
        text: `“${shown.text}”`,
        quote: true,
        icon: { sf: 'quote.bubble.fill', md: 'format_quote', color: theme.text },
        onPress: q.original ? () => setOriginal((o) => !o) : undefined,
      },
      ...(task.mobilizationId
        ? []
        : [{ id: 'summary', at: task.createdAt, who: 'Moloop', text: task.summary, icon: { sf: 'sparkles', md: 'auto_awesome' } }]),
      ...events.filter((e) => e.kind !== 'created').map((e) => eventEntry(e, theme)),
    ];
  }, [task.createdAt, task.reporter, task.summary, task.mobilizationId, events, original, theme]);

  return (
    <Animated.View key={task.id} entering={FadeIn.duration(220)}>
      <LogSheet
        onHeadLayout={onHeadLayout}
        minHeight={minHeight}
        head={
          <>
            <Head title={task.title} lead={<PrioritySignal priority={task.priority} size={14} />}>
              <View style={styles.where}>
                <Text tone="secondary" style={styles.flex} numberOfLines={1}>
                  {place}
                </Text>
                {route && (
                  <View style={styles.walk}>
                    <Icon
                      sf={route.here ? 'location.fill' : 'figure.walk'}
                      md={route.here ? 'my_location' : 'directions_walk'}
                      size={14}
                      color={theme.tint}
                    />
                    <Text tone="secondary" tabular>
                      {route.here ? 'You’re here' : `${route.minutes} min`}
                    </Text>
                  </View>
                )}
                {route && !route.here && (
                  <Button
                    variant="plain"
                    size="inline"
                    label="Directions"
                    accessibilityLabel={`${route.minutes} minute walk. Directions`}
                    onPress={() => router.push({ pathname: '/navigate/[id]', params: { id: task.id } })}
                  />
                )}
              </View>
            </Head>
            {helping && (
              <View style={styles.owner}>
                <Owner task={task} />
              </View>
            )}
          </>
        }
      >
        {task.mobilizationId && (
          <View style={styles.brief}>
            <Text>{task.summary}</Text>
            <Text variant="footnote" tone="secondary" style={styles.small}>
              {confirmedPeopleCount(task)} of {task.requiredCount} people committed
            </Text>
            {!!task.requiredSkills?.length && (
              <Text variant="footnote" tone="secondary" style={styles.small}>
                Required skills: {task.requiredSkills.join(', ')}
              </Text>
            )}
          </View>
        )}
        <LogLines id={task.id} entries={entries} expanded={expanded} onExpand={onExpand} continues={!!status} />
        {status && <NowLine status={status} />}
      </LogSheet>
    </Animated.View>
  );
}

/**
 * No task: the head says so; the log is the shift so far, each finished task one line (tap for its page).
 * Done tasks come newest first; the log reads oldest first.
 */
export function FreeSheet({ done, onHeadLayout, minHeight, expanded, onExpand }: { done: Task[] } & SheetProps) {
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
    icon: { sf: 'checkmark.circle.fill', md: 'check_circle', color: theme.success },
    onPress: () => router.push({ pathname: '/task/[id]', params: { id: t.id } }),
  }));

  return (
    <LogSheet
      onHeadLayout={onHeadLayout}
      minHeight={minHeight}
      head={
        <Head title={onBreak ? 'On break' : 'Free'}>
          {!!sub && (
            <Text tone="secondary" numberOfLines={1}>
              {sub}
            </Text>
          )}
        </Head>
      }
    >
      <LogLines id="shift" entries={entries} expanded={expanded} onExpand={onExpand} />
    </LogSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  owner: { marginTop: 10 },
  brief: { gap: 6, marginBottom: 16 },
  small: { lineHeight: 18 },
});

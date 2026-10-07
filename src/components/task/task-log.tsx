import type { ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Dot } from '@/components/ui/dot';
import { Icon } from '@/components/ui/icon';
import { PressableOpacity } from '@/components/ui/pressable';
import { runStatusAction } from '@/components/ui/status-line';
import { Text } from '@/components/ui/text';
import { clockTime, REPLY_SF } from '@/lib/format';
import type { TaskEvent } from '@/lib/schema';
import type { Status } from '@/lib/status';
import { toneColor, useTheme } from '@/hooks/use-theme';

type Theme = ReturnType<typeof useTheme>;

/*
 * The pieces of a task as a running log: a pinned head (what and where), then lines on an icon rail, oldest first,
 * so the newest sits lowest, next to the thumb. Each line says what happened; when and who sit quietly under it.
 * The status is the last and largest line. Volunteers, leads and Mo all read the same log.
 */

export type LogIcon = { sf: string; md: string; color?: string };

export type LogEntry = {
  id: string;
  at: number;
  /** Who said or did it, after the time under the line (the reporter, Moloop, a volunteer). */
  who?: string;
  text: string;
  /** What they said with it, quoted under the line. */
  note?: string;
  /** The reporter's own words: full strength, the rest is quieter. */
  quote?: boolean;
  /** The mark on the rail. */
  icon?: LogIcon;
  onPress?: () => void;
};

const KIND_SF: Record<TaskEvent['kind'], string> = {
  created: 'square.and.pencil',
  assigned: 'person.crop.circle.badge.checkmark',
  queued: 'tray.full',
  reply: 'bubble.left.fill',
  nudged: 'bell.fill',
  lead_alerted: 'exclamationmark.triangle.fill',
  escalated: 'exclamationmark.bubble.fill',
  reassigned: 'arrow.triangle.2.circlepath',
  resolved: 'checkmark.circle.fill',
  note: 'note.text',
  responded: 'person.crop.circle.badge.exclamationmark',
  bumped: 'arrow.up.circle.fill',
  proposed: 'sparkles',
  helper_added: 'person.badge.plus',
};

/** Android (Material Symbols) fallbacks for the same events. */
const KIND_MD: Record<TaskEvent['kind'], string> = {
  created: 'edit_square',
  assigned: 'person_check',
  queued: 'inbox',
  reply: 'chat_bubble',
  nudged: 'notifications',
  lead_alerted: 'warning',
  escalated: 'priority_high',
  reassigned: 'sync_alt',
  resolved: 'check_circle',
  note: 'notes',
  responded: 'support_agent',
  bumped: 'arrow_circle_up',
  proposed: 'auto_awesome',
  helper_added: 'person_add',
};

/** Replies carry their own mark: accepted, declined, done, help, still on it. */
const REPLY_MD: Record<NonNullable<TaskEvent['reply']>, string> = {
  accept: 'check',
  decline: 'close',
  done: 'check_circle',
  need_help: 'priority_high',
  still_on_it: 'schedule',
};

/**
 * An event's mark. Escalation reads in order: asked for help (red), passed up (orange), then the response (blue).
 * The routine machinery stays grey, so the coloured marks are the ones worth a look.
 */
export function eventIcon(e: TaskEvent, theme: Theme): LogIcon {
  const color =
    e.kind === 'resolved' || e.reply === 'done'
      ? theme.success
      : e.kind === 'lead_alerted' || e.kind === 'escalated' || e.reply === 'need_help'
        ? theme.danger
        : e.kind === 'nudged' || e.kind === 'bumped'
          ? theme.warning
          : e.kind === 'responded' || e.actor.kind === 'human'
            ? theme.tint
            : theme.textTertiary;
  return { sf: e.reply ? REPLY_SF[e.reply] : KIND_SF[e.kind], md: e.reply ? REPLY_MD[e.reply] : KIND_MD[e.kind], color };
}

/** An event as a log line: a person by name; anything automatic is Moloop. */
export function eventEntry(e: TaskEvent, theme: Theme): LogEntry {
  const who = e.actor.kind === 'human' && e.actor.name ? e.actor.name : 'Moloop';
  return { id: e.id, at: e.at, text: e.text, note: e.note, who, icon: eventIcon(e, theme) };
}

/** Lines shown before "Show earlier": few enough that the status still shows above the buttons at the middle stop. */
const RECENT = 2;
const RAIL = 24;
const GAP = 12;

/**
 * The sheet's frame: the head (measured, so the collapsed sheet shows exactly it), a hairline, then the log.
 * `minHeight` is what's visible at the resting stop: the log fills it from the bottom, so a short log still ends
 * at the thumb.
 */
export function LogSheet({ head, onHeadLayout, minHeight, children }: {
  head: ReactNode;
  onHeadLayout?: (height: number) => void;
  minHeight?: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.sheet, { minHeight }]}>
      <View onLayout={(e: LayoutChangeEvent) => onHeadLayout?.(Math.ceil(e.nativeEvent.layout.height))} style={styles.head}>
        {head}
      </View>
      <View style={[styles.rule, { backgroundColor: theme.separator }]} />
      <View style={styles.log}>{children}</View>
    </View>
  );
}

/** A title, with `lead` in front of it (the priority), and the line under it. */
export function Head({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <View style={styles.titleRow}>
        {lead && <View style={styles.lead}>{lead}</View>}
        <Text variant="title" style={styles.flex} numberOfLines={2}>{title}</Text>
      </View>
      {children}
    </>
  );
}

/**
 * Lower down, the last few lines so the newest sits at the thumb; "Show earlier" opens the sheet, which shows them
 * all and starts at the end, so earlier lines are a scroll up. `continues`: a Now line follows, so the rail runs on.
 */
export function LogLines({ id, entries, expanded, onExpand, continues }: {
  id: string;
  entries: LogEntry[];
  expanded?: boolean;
  onExpand?: () => void;
  continues?: boolean;
}) {
  const hidden = expanded ? 0 : Math.max(0, entries.length - RECENT);
  const shown = entries.slice(hidden);
  return (
    <>
      {hidden > 0 && (
        <Button
          variant="plain"
          size="inline"
          label="Show earlier"
          haptic="none"
          onPress={() => onExpand?.()}
          style={styles.earlier}
        />
      )}
      {shown.map((l, i) => (
        <LogLine key={`${id}-${l.id}`} entry={l} last={!continues && i === shown.length - 1} />
      ))}
    </>
  );
}

/** One line: its mark on the rail, what happened, then the time and who, quietly, under it. */
export function LogLine({ entry: l, last }: { entry: LogEntry; last?: boolean }) {
  const theme = useTheme();
  const color = l.icon?.color ?? theme.textTertiary;
  const meta = [clockTime(l.at), l.who].filter(Boolean).join(' · ');
  const body = (
    <>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: `${color}1A` }]}>
          {l.icon ? (
            <Icon sf={l.icon.sf} md={l.icon.md} size={12} color={color} weight="medium" />
          ) : (
            <Dot color={color} size={6} />
          )}
        </View>
        {!last && <View style={[styles.line, { backgroundColor: theme.separator }]} />}
      </View>
      <View style={[styles.body, !last && styles.spaced]}>
        <Text tone={l.quote ? 'primary' : 'secondary'}>{l.text}</Text>
        {l.note && <Text>“{l.note}”</Text>}
        <Text variant="meta" tone="tertiary" style={styles.meta}>{meta}</Text>
      </View>
    </>
  );
  return (
    <Animated.View entering={FadeIn.duration(180)}>
      {l.onPress ? (
        <PressableOpacity accessibilityRole="button" onPress={l.onPress} style={styles.row}>
          {body}
        </PressableOpacity>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );
}

/** Keeps the tail of a status ("· 1 min") on one line with the word before it, so a wrap never strands "min". */
const glue = (label: string) =>
  label.replace(/ (\S+) · (.+)$/, (_, w: string, t: string) => ` ${w} · ${t.replace(/ /g, ' ')}`);

/** Now: the status as the newest, largest line, a solid mark at the end of the rail. Tappable when it asks for something. */
export function NowLine({ status }: { status: Status }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const color = status.tone === 'neutral' ? theme.text : toneColor(theme, status.tone);
  const action = status.action;
  const label = (
    <Text variant="hero" color={color} style={styles.now}>{glue(status.label)}</Text>
  );
  return (
    <Animated.View
      key={`${status.label}-${status.detail ?? ''}`}
      entering={reduced ? FadeIn.duration(1) : FadeInDown.duration(240)}
      style={styles.row}>
      <View style={[styles.rail, styles.nowRail]}>
        <Dot color={color} size={12} />
      </View>
      <View style={styles.flex}>
        {action ? (
          <PressableOpacity
            accessibilityRole="button"
            accessibilityLabel={status.detail ? `${status.label}, ${status.detail}` : status.label}
            haptic="selection"
            onPress={() => runStatusAction(action)}>
            {label}
            {status.detail && <Text tone="tint" style={styles.detail}>{status.detail}</Text>}
          </PressableOpacity>
        ) : (
          <>
            {label}
            {status.detail && <Text tone="secondary" style={styles.detail}>{status.detail}</Text>}
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { flexGrow: 1 },
  head: { gap: 2, paddingBottom: 14 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -20 },
  // Grows to fill the resting stop and keeps its lines at the bottom. The rows space themselves, so the rail is unbroken.
  log: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // As tall as the title's first line, so the priority sits beside it when the title wraps.
  lead: { height: 24, justifyContent: 'center' },
  earlier: { alignSelf: 'flex-start', marginLeft: RAIL + GAP, paddingBottom: 14 },
  row: { flexDirection: 'row', gap: GAP },
  rail: { width: RAIL, alignItems: 'center' },
  dot: { width: RAIL, height: RAIL, borderRadius: RAIL / 2, alignItems: 'center', justifyContent: 'center' },
  line: { width: StyleSheet.hairlineWidth * 2, flex: 1, marginVertical: 3 },
  // Text starts level with the middle of the mark.
  body: { flex: 1, paddingTop: 1, gap: 2 },
  spaced: { paddingBottom: 16 },
  meta: { lineHeight: 16 },
  nowRail: { height: 28, justifyContent: 'center' },
  now: { lineHeight: 28 },
  detail: { marginTop: 2 },
});

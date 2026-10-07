import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { runStatusAction } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import { clockTime } from '@/lib/format';
import type { Status } from '@/lib/status';
import { toneColor, useTheme } from '@/hooks/use-theme';

/*
 * The pieces of the sheet as a running log: a pinned head (what and where), then timestamped lines, oldest first,
 * so the newest sits lowest, next to the thumb. The status is the last and largest line.
 */

export type LogEntry = {
  id: string;
  at: number;
  /** Who said it, over the line (the reporter, Moloop). */
  who?: string;
  text: string;
  /** What they said with it, quoted under the line. */
  note?: string;
  /** The reporter's own words: full strength, the rest is quieter. */
  quote?: boolean;
  onPress?: () => void;
};

/** Lines shown before "Show earlier": few enough that the status still shows above the buttons at the middle stop. */
const RECENT = 2;

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

/** A title and the line under it. */
export function Head({ title, children }: { title: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>{title}</Text>
      {children}
    </>
  );
}

/** The last few lines, with the rest one tap away. Resets when `id` (the task) changes. */
export function LogLines({ id, entries }: { id: string; entries: LogEntry[] }) {
  const theme = useTheme();
  const [all, setAll] = useState(false);
  const [allFor, setAllFor] = useState(id);
  if (allFor !== id) {
    setAllFor(id);
    setAll(false);
  }
  const hidden = all ? 0 : Math.max(0, entries.length - RECENT);
  return (
    <>
      {hidden > 0 && (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={8} style={({ pressed }) => [styles.earlier, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.small, styles.strong, { color: theme.tint }]}>Show earlier</Text>
        </Pressable>
      )}
      {entries.slice(hidden).map((l) => (
        <LogLine key={`${id}-${l.id}`} entry={l} />
      ))}
    </>
  );
}

function LogLine({ entry: l }: { entry: LogEntry }) {
  const theme = useTheme();
  const body = (
    <>
      <Text style={[styles.time, { color: theme.textTertiary }]}>{clockTime(l.at)}</Text>
      <View style={styles.flex}>
        {l.who && <Text style={[styles.small, { color: theme.textTertiary }]}>{l.who}</Text>}
        <Text style={[styles.text, { color: l.quote ? theme.text : theme.textSecondary }]}>{l.text}</Text>
        {l.note && <Text style={[styles.text, { color: theme.text }]}>“{l.note}”</Text>}
      </View>
    </>
  );
  return (
    <Animated.View entering={FadeIn.duration(180)}>
      {l.onPress ? (
        <Pressable accessibilityRole="button" onPress={l.onPress} style={({ pressed }) => [styles.line, { opacity: pressed ? 0.6 : 1 }]}>
          {body}
        </Pressable>
      ) : (
        <View style={styles.line}>{body}</View>
      )}
    </Animated.View>
  );
}

/** Keeps the tail of a status ("· 1 min") on one line with the word before it, so a wrap never strands "min". */
const glue = (label: string) =>
  label.replace(/ (\S+) · (.+)$/, (_, w: string, t: string) => ` ${w} · ${t.replace(/ /g, ' ')}`);

/** Now: the status as the newest, largest line. Tappable when it asks for something ("Send an update"). */
export function NowLine({ status }: { status: Status }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const color = status.tone === 'neutral' ? theme.text : toneColor(theme, status.tone);
  const action = status.action;
  const label = (
    <Text style={[styles.now, { color }]}>{glue(status.label)}</Text>
  );
  return (
    <Animated.View
      key={`${status.label}-${status.detail ?? ''}`}
      entering={reduced ? FadeIn.duration(1) : FadeInDown.duration(240)}
      style={styles.line}>
      <Text style={[styles.time, styles.nowTime, styles.strong, { color }]}>Now</Text>
      <View style={styles.flex}>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={status.detail ? `${status.label}, ${status.detail}` : status.label}
            onPress={() => {
              Haptics.selectionAsync();
              runStatusAction(action);
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            {label}
            {status.detail && <Text style={[styles.detail, { color: theme.tint }]}>{status.detail}</Text>}
          </Pressable>
        ) : (
          <>
            {label}
            {status.detail && <Text style={[styles.detail, { color: theme.textSecondary }]}>{status.detail}</Text>}
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
  // Grows to fill the resting stop and keeps its lines at the bottom.
  log: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 16, gap: 14 },
  title: { fontSize: Type.title, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  text: { fontSize: Type.body, lineHeight: 21 },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  strong: { fontWeight: '600' },
  earlier: { alignSelf: 'flex-start', marginLeft: 68 },
  line: { flexDirection: 'row', gap: 12 },
  time: { width: 56, fontSize: Type.footnote, lineHeight: 21, fontVariant: ['tabular-nums'] },
  nowTime: { lineHeight: 28 },
  now: { fontSize: Type.hero, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  detail: { fontSize: Type.body, lineHeight: 21, marginTop: 2 },
});

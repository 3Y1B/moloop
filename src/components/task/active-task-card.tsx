import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { MapPreview } from '@/components/map/map-preview';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useSnapshot, useTaskStatus } from '@/data/hooks';
import { quoteFor } from '@/lib/quote';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import { PriorityBadge, TeamChip } from './badges';
import { ReplyBar } from './reply-bar';

/**
 * The hero, compact: what, where, how to get there, and the next tap. The story behind it
 * (summary, reporter's words, team) is one tap away under Details; the full history is on the task page.
 * Status lives in one place, the top-right line (lib/status). Backing someone up, the card says whose task it is.
 */
export function ActiveTaskCard({ task, showReplies = true, showTimelineLink = true, defaultExpanded = false }: {
  task: Task;
  showReplies?: boolean;
  showTimelineLink?: boolean;
  defaultExpanded?: boolean;
}) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const status = useTaskStatus(task);
  const { meId } = useSnapshot();
  const { zones } = useLookups();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;
  const helping = !!meId && task.helperIds.includes(meId);

  return (
    <Animated.View layout={LinearTransition.duration(220)}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <PriorityBadge priority={task.priority} />
          {/* No countdowns or "overdue" here: the scheduler handles timing, the volunteer just sees how long it's been. */}
          {status && (
            <View style={styles.status}>
              <StatusLine status={status} />
            </View>
          )}
        </View>

        <Text style={[styles.title, { color: theme.text }]}>{task.title}</Text>

        {zone && (
          <View style={styles.location}>
            <Icon sf="mappin" md="location_on" size={13} color={accent} />
            <Text style={[styles.zone, { color: theme.text }]} numberOfLines={1}>
              {zone.name}
              {task.locationHint && <Text style={{ color: theme.textSecondary, fontWeight: '400' }}> · {task.locationHint}</Text>}
            </Text>
          </View>
        )}

        {helping && <Owner task={task} />}

        <MapPreview task={task} />

        {showReplies && <ReplyBar task={task} helping={helping} />}

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              setExpanded((e) => !e);
            }}
            style={styles.footerBtn}>
            <Text style={[styles.link, { color: theme.textSecondary }]}>{expanded ? 'Less' : 'Details'}</Text>
            <Icon sf={expanded ? 'chevron.up' : 'chevron.down'} md={expanded ? 'expand_less' : 'expand_more'} size={11} color={theme.textSecondary} weight="bold" />
          </Pressable>
          {showTimelineLink && (
            <Link href={{ pathname: '/task/[id]', params: { id: task.id, focus: 'timeline' } }} asChild>
              <Pressable hitSlop={8} style={styles.footerBtn}>
                <Text style={[styles.link, { color: theme.tint }]}>Timeline</Text>
                <Icon sf="chevron.right" md="chevron_right" size={11} color={theme.tint} weight="bold" />
              </Pressable>
            </Link>
          )}
        </View>

        {expanded && <Details task={task} />}
      </Card>
    </Animated.View>
  );
}

export function Details({ task }: { task: Task }) {
  const theme = useTheme();
  const { teams } = useLookups();
  // English first; tapping a translated quote shows what they actually said.
  const [original, setOriginal] = useState(false);
  const q = quoteFor(task.reporter);
  const shown = original && q.original ? q.original : { text: q.text, label: q.label };
  const by = task.reporter.name ?? (task.reporter.kind === 'festivalgoer' ? 'Festival-goer' : 'Reporter');
  const quote = (
    <>
      <Text style={[styles.quoteText, { color: theme.textSecondary }]}>“{shown.text}”</Text>
      <Text style={[styles.quoteBy, { color: theme.textTertiary }]}>
        {by}
        {shown.label && <Text style={q.original && { color: theme.tint }}> · {shown.label}</Text>}
      </Text>
    </>
  );
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.details}>
      <Text style={[styles.summary, { color: theme.text }]}>{task.summary}</Text>
      {q.original ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={original ? 'Show the English' : `Show the original, ${q.original.label.replace('Original, ', '')}`}
          onPress={() => setOriginal((o) => !o)}
          style={({ pressed }) => [styles.quote, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
          {quote}
        </Pressable>
      ) : (
        <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>{quote}</View>
      )}
      <TeamChip team={task.teamSlug ? teams[task.teamSlug] : undefined} />
    </Animated.View>
  );
}

/** Backing someone up: whose task it is, and a quick call to them. */
export function Owner({ task }: { task: Task }) {
  const theme = useTheme();
  const { volunteers, teams } = useLookups();
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  if (!owner) return null;
  const color = owner.teamSlug ? teams[owner.teamSlug]?.color : undefined;
  return (
    <View style={styles.owner}>
      <Avatar name={owner.name} color={color} size={22} />
      <Text style={[styles.ownerName, { color: theme.text }]} numberOfLines={1}>{owner.name}</Text>
      {owner.phone && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${owner.name}`}
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync();
            Linking.openURL(`tel:${owner.phone!.replace(/\s+/g, '')}`);
          }}
          style={({ pressed }) => [styles.footerBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon sf="phone.fill" md="call" size={12} color={theme.tint} />
          <Text style={[styles.link, { color: theme.tint }]}>Call</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  // Long status lines ("Emergency services on the way · Stay with them") drop under the badge instead of truncating early.
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 6 },
  status: { flexShrink: 1 },
  title: { fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  location: { flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: -4 },
  zone: { flex: 1, fontSize: Type.footnote, fontWeight: '500' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownerName: { flex: 1, fontSize: Type.footnote, fontWeight: '500' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  link: { fontSize: Type.footnote, fontWeight: '500' },
  details: { gap: 8 },
  summary: { fontSize: Type.callout, lineHeight: 20 },
  quote: { borderRadius: Radius.control - 2, borderCurve: 'continuous', padding: 10, gap: 3 },
  quoteText: { fontSize: Type.callout - 1, lineHeight: 18, fontStyle: 'italic' },
  quoteBy: { fontSize: Type.caption },
});

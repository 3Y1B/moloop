import * as Haptics from 'expo-haptics';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { MapPreview } from '@/components/map/map-preview';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useNow } from '@/data/hooks';
import { ago, languageName, STATUS_LABEL } from '@/lib/format';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import { PriorityBadge, TeamChip } from './badges';
import { ReplyBar } from './reply-bar';

/**
 * The hero, compact: what, where, how to get there, and the next tap. The story behind it
 * (summary, reporter's words, team) is one tap away under Details; the full history is on the task page.
 */
export function ActiveTaskCard({ task, showReplies = true, showTimelineLink = true, defaultExpanded = false }: {
  task: Task;
  showReplies?: boolean;
  showTimelineLink?: boolean;
  defaultExpanded?: boolean;
}) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const now = useNow();
  const { zones } = useLookups();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;

  return (
    <Animated.View layout={LinearTransition.duration(220)}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <PriorityBadge priority={task.priority} />
          {/* No countdowns or "overdue" here: the scheduler handles timing, the volunteer just sees how long it's been. */}
          <Text style={[styles.meta, { color: theme.textTertiary }]} numberOfLines={1}>
            {STATUS_LABEL[task.status]} · {ago(task.assignedAt ?? task.createdAt, now)}
          </Text>
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

        <MapPreview task={task} />

        <CheckIn task={task} canReply={showReplies} />

        {showReplies && <ReplyBar task={task} />}

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

function Details({ task }: { task: Task }) {
  const theme = useTheme();
  const { teams } = useLookups();
  const translated = task.reporter.language !== 'en';
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.details}>
      <Text style={[styles.summary, { color: theme.text }]}>{task.summary}</Text>
      <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
        <Text style={[styles.quoteText, { color: theme.textSecondary }]}>“{task.reporter.quote}”</Text>
        <Text style={[styles.quoteBy, { color: theme.textTertiary }]}>
          {task.reporter.name ?? (task.reporter.kind === 'festivalgoer' ? 'Festival-goer' : 'Reporter')}
          {translated ? ` · translated from ${languageName(task.reporter.language)}` : ''}
        </Text>
      </View>
      <TeamChip team={task.teamSlug ? teams[task.teamSlug] : undefined} />
    </Animated.View>
  );
}

/**
 * One calm line when there's something to say. A nudge and a lead alert read the same to the volunteer
 * (a check-in; "Update" opens the voice/type sheet); escalation just reassures them help is coming.
 */
function CheckIn({ task, canReply }: { task: Task; canReply: boolean }) {
  const theme = useTheme();
  const escalated = task.status === 'escalated';
  const asked = !escalated && (task.nudgeCount > 0 || task.leadAlertedAt != null);
  if (!escalated && !asked) return null;
  return (
    <View style={[styles.banner, { backgroundColor: theme.backgroundElement }]}>
      <Icon
        sf={escalated ? 'person.2' : 'hand.wave'}
        md={escalated ? 'groups' : 'waving_hand'}
        size={13}
        color={theme.textSecondary}
      />
      <Text style={[styles.bannerText, { color: theme.textSecondary }]} numberOfLines={2}>
        {escalated ? 'Help is on the way. Stay with them.' : 'How’s it going?'}
      </Text>
      {asked && canReply && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync();
            router.push({ pathname: '/reply/[id]', params: { id: task.id, kind: 'still_on_it' } });
          }}
          style={({ pressed }) => [styles.bannerAction, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.bannerActionText, { color: theme.text }]}>Update</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta: { fontSize: Type.caption, fontWeight: '500', fontVariant: ['tabular-nums'], flexShrink: 1 },
  title: { fontSize: Type.title, lineHeight: 23, fontWeight: '600', letterSpacing: -0.2 },
  location: { flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: -4 },
  zone: { flex: 1, fontSize: Type.footnote, fontWeight: '500' },
  banner: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.control - 2, borderCurve: 'continuous' },
  bannerText: { flex: 1, fontSize: Type.footnote, fontWeight: '500' },
  bannerAction: { paddingHorizontal: 10, height: 26, borderRadius: Radius.pill, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  bannerActionText: { fontSize: Type.caption, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  link: { fontSize: Type.footnote, fontWeight: '500' },
  details: { gap: 8 },
  summary: { fontSize: Type.callout, lineHeight: 20 },
  quote: { borderRadius: Radius.control - 2, borderCurve: 'continuous', padding: 10, gap: 3 },
  quoteText: { fontSize: Type.callout - 1, lineHeight: 18, fontStyle: 'italic' },
  quoteBy: { fontSize: Type.caption },
});

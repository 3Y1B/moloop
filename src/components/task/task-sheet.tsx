import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { StatusLine } from '@/components/ui/status-line';
import { Type } from '@/constants/theme';
import { useLookups, useRouteTo, useSnapshot, useTaskStatus } from '@/data/hooks';
import { formatMeters } from '@/lib/route';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import { Details, Owner } from './active-task-card';
import { PriorityBadge } from './badges';
import { ReplyBar } from './reply-bar';

/**
 * My task, as the top of the sheet: status, what, where, how far, and the next tap. That much fits
 * at the middle stop. Pull the sheet up for the story behind it; the map behind already shows the way.
 */
export function TaskSheet({ task }: { task: Task }) {
  const theme = useTheme();
  const accent = usePriorityColors()[task.priority];
  const status = useTaskStatus(task);
  const route = useRouteTo(task);
  const { meId } = useSnapshot();
  const { zones } = useLookups();
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;
  const helping = !!meId && task.helperIds.includes(meId);

  return (
    <Animated.View key={task.id} entering={FadeIn.duration(220)} style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.topRow}>
          {status ? <StatusLine status={status} size="callout" style={styles.status} /> : <View />}
          <PriorityBadge priority={task.priority} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{task.title}</Text>
        {zone && (
          <Text style={[styles.where, { color: theme.text }]} numberOfLines={2}>
            {zone.name}
            {task.locationHint && <Text style={{ color: theme.textSecondary, fontWeight: '400' }}> · {task.locationHint}</Text>}
          </Text>
        )}
        {route && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={route.here ? 'You’re here. Directions' : `${route.minutes} minute walk. Directions`}
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: '/navigate/[id]', params: { id: task.id } });
            }}
            style={({ pressed }) => [styles.walk, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon sf={route.here ? 'location.fill' : 'figure.walk'} md={route.here ? 'my_location' : 'directions_walk'} size={13} color={accent} />
            <Text style={[styles.walkText, { color: theme.textSecondary }]}>
              {route.here ? 'You’re here' : `${route.minutes} min · ${formatMeters(route.meters)}`}
            </Text>
            <Text style={[styles.walkText, { color: theme.tint }]}>Directions</Text>
          </Pressable>
        )}
      </View>

      {helping && <Owner task={task} />}
      <ReplyBar task={task} helping={helping} />

      <View style={[styles.rule, { backgroundColor: theme.separator }]} />
      <Details task={task} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id, focus: 'timeline' } })}
        style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon sf="clock" md="schedule" size={14} color={theme.textSecondary} />
        <Text style={[styles.linkText, { color: theme.text }]}>Timeline</Text>
        <Icon sf="chevron.right" md="chevron_right" size={11} color={theme.textTertiary} weight="semibold" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  head: { gap: 6 },
  // Long status lines drop under the badge instead of truncating early.
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 10, rowGap: 6 },
  status: { flexShrink: 1 },
  title: { fontSize: Type.hero, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, marginTop: 2 },
  where: { fontSize: Type.callout, fontWeight: '500', lineHeight: 19 },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  walkText: { fontSize: Type.footnote, fontWeight: '500', fontVariant: ['tabular-nums'] },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  linkText: { flex: 1, fontSize: Type.callout, fontWeight: '500' },
});

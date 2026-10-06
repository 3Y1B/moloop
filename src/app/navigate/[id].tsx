import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VenueMap, type MapPerson } from '@/components/map/venue-map';
import { Button } from '@/components/ui/button';
import { CircleButton } from '@/components/ui/circle-button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useLookups, useMe, useRepo, useRouteTo, useTask } from '@/data/hooks';
import { NODES, VENUE_ZONES } from '@/data/venue';
import { initials, REPLY_LABEL, REPLY_SF } from '@/lib/format';
import { formatMeters, type Step } from '@/lib/route';
import type { ReplyKind } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';

const TURN_ICON: Record<Step['turn'], { sf: string; md: string }> = {
  start: { sf: 'arrow.up', md: 'straight' },
  straight: { sf: 'arrow.up', md: 'straight' },
  left: { sf: 'arrow.turn.up.left', md: 'turn_left' },
  right: { sf: 'arrow.turn.up.right', md: 'turn_right' },
  arrive: { sf: 'mappin.and.ellipse', md: 'location_on' },
};

/** Walking directions to a task: where I am, where they are, and how to get there. */
export default function NavigateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const repo = useRepo();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const task = useTask(id);
  const me = useMe();
  const route = useRouteTo(task);
  const { zones, volunteers } = useLookups();
  const accent = usePriorityColors()[task?.priority ?? 'P3'];
  const [fit, setFit] = useState<'route' | 'site'>('route');

  if (!task) return null;

  const mapHeight = Math.round(height * 0.5);
  const myZone = me?.zoneSlug ? VENUE_ZONES[me.zoneSlug] : undefined;
  const zone = task.zoneSlug ? zones[task.zoneSlug] : undefined;

  // Teammates on shift, so you can see who's nearby if you need a hand.
  const people: MapPerson[] = Object.values(volunteers)
    .filter((v) => v.id !== me?.id && v.teamSlug === me?.teamSlug && v.duty === 'on_duty' && v.zoneSlug && VENUE_ZONES[v.zoneSlug])
    .map((v) => {
      const n = NODES[VENUE_ZONES[v.zoneSlug!].node];
      return { id: v.id, initials: initials(v.name), color: theme.textTertiary, at: { x: n.x + 10, y: n.y - 10 } };
    });

  const mine = task.assigneeId === me?.id;
  const next: ReplyKind | null = mine && task.status === 'assigned' ? 'accept' : null;

  return (
    <View style={[styles.flex, { backgroundColor: theme.mapGround }]}>
      <VenueMap
        route={route}
        me={myZone ? NODES[myZone.node] : null}
        target={task.zoneSlug}
        targetColor={accent}
        people={people}
        fit={fit}
        aspect={width / mapHeight}
        style={{ height: mapHeight + 40 }}
      />
      <CircleButton
        label={fit === 'route' ? 'Show whole site' : 'Zoom to route'}
        size={44}
        onPress={() => setFit((f) => (f === 'route' ? 'site' : 'route'))}
        style={[styles.fitButton, { top: mapHeight - 56 }]}>
        <Icon sf={fit === 'route' ? 'map' : 'location.viewfinder'} md={fit === 'route' ? 'map' : 'center_focus_strong'} size={18} color={theme.text} />
      </CircleButton>

      <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.border, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.summary}>
          <View style={styles.flex}>
            <Text style={[styles.big, { color: theme.text }]}>
              {route?.here ? 'You’re here' : route ? `${route.minutes} min` : 'No route'}
            </Text>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>
              {route && !route.here ? `${formatMeters(route.meters)} walk` : zone?.name ?? ''}
            </Text>
          </View>
          <View style={[styles.dest, { backgroundColor: `${accent}1A` }]}>
            <Icon sf="mappin" md="location_on" size={13} color={accent} />
            <Text style={[styles.destText, { color: accent }]} numberOfLines={1}>{zone?.name ?? 'Unknown'}</Text>
          </View>
        </View>

        <Text style={[styles.taskTitle, { color: theme.text }]} numberOfLines={1}>{task.title}</Text>

        <ScrollView style={styles.steps} contentContainerStyle={styles.stepsContent}>
          {route?.steps.map((s, i) => {
            const icon = TURN_ICON[s.turn];
            const last = s.turn === 'arrive';
            return (
              <View key={i} style={styles.step}>
                <View style={[styles.stepIcon, { backgroundColor: last ? `${accent}1F` : theme.backgroundElement }]}>
                  <Icon sf={icon.sf} md={icon.md} size={14} color={last ? accent : theme.text} weight="medium" />
                </View>
                <Text style={[styles.stepText, { color: theme.text }]}>{s.text}</Text>
                {s.meters > 0 && <Text style={[styles.stepMeta, { color: theme.textTertiary }]}>{formatMeters(s.meters)}</Text>}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.actions}>
          {next ? (
            <Button
              size="large"
              label={REPLY_LABEL[next]}
              sf={REPLY_SF[next]}
              haptic="success"
              color={theme.tint}
              onPress={() => repo.reply(task.id, next)}
              style={styles.flex}
            />
          ) : (
            <Button size="large" label="Back to task" sf="chevron.left" variant="tinted" onPress={() => router.back()} style={styles.flex} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fitButton: { position: 'absolute', right: 16 },
  sheet: {
    flex: 1, marginTop: -40, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: 'continuous',
    paddingTop: 18, paddingHorizontal: 18, gap: 8, borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  big: { fontSize: Type.hero + 2, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  sub: { fontSize: Type.footnote, fontWeight: '500' },
  dest: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: Radius.pill, maxWidth: '55%' },
  destText: { fontSize: Type.footnote, fontWeight: '600', flexShrink: 1 },
  taskTitle: { fontSize: Type.callout, fontWeight: '500', opacity: 0.8 },
  steps: { flex: 1 },
  stepsContent: { gap: 2, paddingVertical: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stepIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, fontSize: Type.callout, fontWeight: '500', lineHeight: 19 },
  stepMeta: { fontSize: Type.footnote, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 6 },
});

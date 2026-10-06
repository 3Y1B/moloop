import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { NODES, VENUE_ZONES } from '@/data/venue';
import { useMe, useRouteTo } from '@/data/hooks';
import { formatMeters } from '@/lib/route';
import type { Task } from '@/lib/schema';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import { VenueMap } from './venue-map';

/** Tall enough to actually read the route, not just see that there is one. */
const HEIGHT = { route: 156, here: 116 } as const;

/** Glanceable route on the task card. Tap for full walking directions. */
export function MapPreview({ task }: { task: Task }) {
  const theme = useTheme();
  const me = useMe();
  const route = useRouteTo(task);
  const accent = usePriorityColors()[task.priority];
  const [width, setWidth] = useState(330);
  if (!task.zoneSlug || !VENUE_ZONES[task.zoneSlug]) return null;
  const myZone = me?.zoneSlug ? VENUE_ZONES[me.zoneSlug] : undefined;
  const height = route?.here ? HEIGHT.here : HEIGHT.route;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={route?.here ? 'You are here. Open map' : `Directions, ${route?.minutes ?? ''} minute walk`}
      onPress={() => router.push({ pathname: '/navigate/[id]', params: { id: task.id } })}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={({ pressed }) => [styles.wrap, { height, opacity: pressed ? 0.85 : 1 }]}>
      <VenueMap
        route={route}
        me={myZone ? NODES[myZone.node] : null}
        target={task.zoneSlug}
        targetColor={accent}
        aspect={width / height}
        labels
        style={styles.map}
      />
      <View style={styles.overlay}>
        <View style={[styles.eta, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Icon sf={route?.here ? 'location.fill' : 'figure.walk'} md={route?.here ? 'my_location' : 'directions_walk'} size={12} color={theme.tint} weight="medium" />
          <Text style={[styles.etaText, { color: theme.text }]}>
            {route?.here ? 'You’re here' : route ? `${route.minutes} min · ${formatMeters(route.meters)}` : 'Map'}
          </Text>
        </View>
        <View style={[styles.go, { backgroundColor: theme.tint }]}>
          <Icon sf="arrow.triangle.turn.up.right.diamond.fill" md="directions" size={12} color="#fff" />
          <Text style={styles.goText}>Directions</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: Radius.control, borderCurve: 'continuous', overflow: 'hidden' },
  map: { ...StyleSheet.absoluteFill },
  overlay: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  eta: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 26, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth * 2 },
  etaText: { fontSize: Type.caption, fontWeight: '600', fontVariant: ['tabular-nums'] },
  go: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 26, borderRadius: Radius.pill },
  goText: { color: '#fff', fontSize: Type.caption, fontWeight: '600' },
});

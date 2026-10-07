import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { NODES, VENUE_ZONES, type Point } from '@/data/venue';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import { DOT, PIN, spread, type MapMarker, type VenueMapProps } from './map-model';

/** One thing pinned to the map: where, which part of the view sits on that spot, and what to draw. */
export type Overlay = { key: string; at: Point; anchor: 'center' | 'bottom'; view: ReactElement; onPress?: () => void };

/** Everything that floats over the map, in draw order (later on top). */
export function useOverlays(p: VenueMapProps, metresPerPoint: number): Overlay[] {
  const theme = useTheme();
  const priorityColor = usePriorityColors();
  const accent = p.targetColor ?? theme.danger;
  const dest = p.target ? VENUE_ZONES[p.target] : undefined;
  const out: Overlay[] = [];

  for (const person of p.people ?? []) {
    out.push({ key: `p-${person.id}`, at: person.at, anchor: 'center', view: <Dot color={person.color} initials={person.initials} /> });
  }
  for (const m of spread(p.markers ?? [], metresPerPoint)) {
    const onPress = p.onMarkerPress ? () => p.onMarkerPress!(m) : undefined;
    out.push({ key: `m-${m.kind}-${m.id}`, at: m.at, onPress, ...markerView(m, theme.danger, priorityColor) });
  }
  if (dest && !p.route?.here) out.push({ key: 'dest', at: NODES[dest.node], anchor: 'bottom', view: <Pin color={accent} size={1.15} /> });
  if (p.me) out.push({ key: 'me', at: p.me, anchor: 'center', view: <Me color={theme.tint} /> });
  return out;
}

function markerView(m: MapMarker, danger: string, priorityColor: Record<string, string>): Pick<Overlay, 'anchor' | 'view'> {
  if (m.kind === 'task') return { anchor: 'bottom', view: <Pin color={priorityColor[m.priority]} /> };
  const help = m.kind === 'volunteer' && m.needsHelp;
  const ring = m.kind === 'volunteer' && (m.onTask || m.needsHelp);
  const stale = m.kind === 'volunteer' && m.stale;
  return { anchor: 'center', view: <Dot color={help ? danger : m.color} initials={m.initials} ring={ring} stale={stale} /> };
}

/** A person: a dot in their colour with initials, ringed when busy, faded where they were last seen. */
function Dot({ color, initials, ring, stale }: { color: string; initials?: string; ring?: boolean; stale?: boolean }) {
  const theme = useTheme();
  // An ink dot (the crew) inverts with the scheme, so its initials take the background colour.
  const ink = color === theme.text ? theme.background : theme.onTint;
  return (
    <View style={[styles.ringBox, ring && { borderColor: color }, stale && styles.stale]}>
      <View style={[styles.dot, { backgroundColor: color }]}>
        {!!initials && <Text style={[styles.initials, { color: ink }]}>{initials}</Text>}
      </View>
    </View>
  );
}

/** A teardrop pin whose tip marks the spot. */
function Pin({ color, size = 1 }: { color: string; size?: number }) {
  const w = PIN.w * size, h = PIN.h * size;
  return (
    <Svg width={w} height={h} viewBox="-14 -36 28 37">
      <Path d="M0 0 C -4 -8, -12 -12, -12 -22 A 12 12 0 1 1 12 -22 C 12 -12, 4 -8, 0 0 Z" fill={color} stroke="#fff" strokeWidth={2} />
      <Circle cy={-22} r={4.5} fill="#fff" />
    </Svg>
  );
}

/** Me: the standard location puck. A blue dot in a white ring, on a faint blue halo. */
function Me({ color }: { color: string }) {
  return (
    <View style={styles.meBox}>
      <View style={[styles.meHalo, { backgroundColor: `${color}26`, borderColor: `${color}4D` }]} />
      <View style={styles.meOuter}>
        <View style={[styles.meInner, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const ME = 32;
const styles = StyleSheet.create({
  ringBox: { width: DOT + 8, height: DOT + 8, borderRadius: (DOT + 8) / 2, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 9, fontWeight: '700' },
  stale: { opacity: 0.45 },
  meBox: { width: ME, height: ME, alignItems: 'center', justifyContent: 'center' },
  meHalo: { position: 'absolute', width: ME, height: ME, borderRadius: ME / 2, borderWidth: StyleSheet.hairlineWidth },
  meOuter: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' },
  meInner: { width: 13, height: 13, borderRadius: 6.5 },
});

import { useEffect, useId } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { VoiceGradient } from '@/constants/theme';
import { EDGES, NODES, SCENERY, VENUE, VENUE_ZONES, type Point, type VenueZone } from '@/data/venue';
import { usePriorityColors, useTheme } from '@/hooks/use-theme';
import type { Route } from '@/lib/route';
import type { Priority } from '@/lib/schema';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
// SVG text defaults to a serif on web; native already uses the system font.
const MAP_FONT = Platform.select({ web: 'system-ui, -apple-system, sans-serif', default: undefined });
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MapPerson = { id: string; initials: string; color: string; at: Point };

/**
 * Things drawn on top of the site plan for leads and festival-goers.
 *  - volunteer: team-coloured dot, a ring when on a task, red when they asked for help
 *  - task: a pin in its priority colour
 *  - person: someone who isn't a volunteer, e.g. the festival-goer at the end of a two-person route
 * For a two-person route (volunteer → reporter), pass `route` plus a volunteer and a person marker, and `me={null}`.
 */
export type MapMarker =
  | { kind: 'volunteer'; id: string; at: Point; color: string; initials?: string; onTask?: boolean; needsHelp?: boolean }
  | { kind: 'task'; id: string; at: Point; priority: Priority }
  | { kind: 'person'; id: string; at: Point; color: string; initials?: string };

/** A spot near a zone's path node, spread around it so several markers in one zone don't stack. */
export function zoneSpot(zoneSlug: string | null, index = 0): Point | null {
  const zone = zoneSlug ? VENUE_ZONES[zoneSlug] : undefined;
  if (!zone) return null;
  const n = NODES[zone.node];
  if (index === 0) return { x: n.x, y: n.y };
  const angle = (index - 1) * 2.4; // golden-ish angle: no two neighbours line up
  const r = 11 + 4 * Math.floor((index - 1) / 6);
  return { x: n.x + Math.cos(angle) * r, y: n.y + Math.sin(angle) * r };
}

type Props = {
  route: Route | null;
  /** Where I am (start of route, or my zone when there is no route). */
  me: Point | null;
  /** Destination zone slug, highlighted with a pin. */
  target?: string | null;
  targetColor?: string;
  /** Teammates to show as small initials. */
  people?: MapPerson[];
  /** Volunteers, task pins and people (see MapMarker). */
  markers?: MapMarker[];
  onMarkerPress?: (marker: MapMarker) => void;
  /** Zoom to the route (cards) or show the whole site (navigation). */
  fit?: 'route' | 'site';
  /** Width ÷ height of the container, so the framed area fills it. */
  aspect: number;
  /**
   * Fractions of the height covered by things floating over the map (top controls, a bottom sheet).
   * What's being framed is centred in the part that's left.
   */
  frame?: { top: number; bottom: number };
  labels?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Stylised site plan with my position, the destination and the walking route. */
export function VenueMap({
  route, me, target, targetColor, people = [], markers: placed = [], onMarkerPress, fit = 'route', aspect, frame, labels = true, style,
}: Props) {
  const theme = useTheme();
  const priorityColor = usePriorityColors();
  // One gradient id per map: on the web every SVG shares the page's id space, and a map left
  // mounted on a screen underneath would otherwise lend this one its (hidden) gradient.
  const gradient = `route${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const dest = target ? VENUE_ZONES[target] : undefined;
  const destPoint = dest ? NODES[dest.node] : null;
  const pts = route?.points ?? [];

  const box = framed(
    viewBoxFor(
      fit === 'site' ? [] : [...pts, ...(me ? [me] : []), ...(destPoint ? [destPoint] : []), ...placed.map((m) => m.at)],
      aspect / (1 - (frame?.top ?? 0) - (frame?.bottom ?? 0)),
    ),
    frame,
  );

  const dash = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    dash.set(withRepeat(withTiming(-28, { duration: 1100, easing: Easing.linear }), -1, false));
    pulse.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
    return () => {
      cancelAnimation(dash);
      cancelAnimation(pulse);
    };
  }, [dash, pulse]);
  const dashProps = useAnimatedProps(() => ({ strokeDashoffset: dash.get() }));
  const pulseProps = useAnimatedProps(() => ({ r: 6 + pulse.get() * 16, opacity: 0.45 * (1 - pulse.get()) }));

  const scale = box.w / 400; // keep strokes and type a constant on-screen size whatever the zoom
  const markers = spread(placed, 6 * scale + 2.5, pinSize(scale * 0.75));
  const routePoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const accent = targetColor ?? theme.danger;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.mapGround }, style]}>
      <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            {VoiceGradient.map((c, i) => <Stop key={c} offset={i / (VoiceGradient.length - 1)} stopColor={c} />)}
          </LinearGradient>
        </Defs>

        <Rect x={-200} y={-200} width={VENUE.width + 400} height={VENUE.height + 400} fill={theme.mapGround} />
        <Path d={SCENERY.river} fill={theme.mapWater} />
        <Rect {...SCENERY.lawn} rx={22} fill={theme.mapGrass} />

        {/* Walkways */}
        <G stroke={theme.mapPath} strokeWidth={9} strokeLinecap="round">
          {EDGES.map(([a, b]) => (
            <Line key={a + b} x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} />
          ))}
        </G>

        {Object.values(VENUE_ZONES).map((z) => (
          <ZoneShape key={z.slug} zone={z} highlight={z.slug === target ? accent : undefined} labels={labels} scale={scale} box={box} />
        ))}

        {pts.length > 1 && (
          <>
            <Polyline points={routePoints} fill="none" stroke={`url(#${gradient})`} strokeOpacity={0.35} strokeWidth={8 * scale + 2} strokeLinecap="round" strokeLinejoin="round" />
            <AnimatedPolyline
              points={routePoints}
              fill="none"
              stroke={`url(#${gradient})`}
              strokeWidth={4 * scale + 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[8, 6]}
              animatedProps={dashProps}
            />
          </>
        )}

        {people.map((p) => (
          <G key={p.id}>
            <Circle cx={p.at.x} cy={p.at.y} r={7 * scale + 3} fill={p.color} stroke="#fff" strokeWidth={1.5} />
            <SvgText fontFamily={MAP_FONT} x={p.at.x} y={p.at.y + 2.6 * scale + 1} fontSize={6 * scale + 2} fontWeight="700" fill="#fff" textAnchor="middle">
              {p.initials}
            </SvgText>
          </G>
        ))}

        {markers.map((m) => {
          const press = onMarkerPress ? () => onMarkerPress(m) : undefined;
          if (m.kind === 'task') return <Pin key={m.id} at={m.at} color={priorityColor[m.priority]} scale={scale * 0.75} onPress={press} />;
          const r = 6 * scale + 2.5;
          const fill = m.kind === 'volunteer' && m.needsHelp ? theme.danger : m.color;
          return (
            <G key={m.id} transform={`translate(${m.at.x} ${m.at.y})`} {...pressable(press)}>
              {m.kind === 'volunteer' && (m.onTask || m.needsHelp) && (
                <Circle r={r + 3 * scale + 1.5} fill="none" stroke={fill} strokeWidth={1.5 * scale + 0.5} />
              )}
              <Circle r={r} fill={fill} stroke="#fff" strokeWidth={1.5} />
              {m.initials && (
                <SvgText fontFamily={MAP_FONT} y={2.4 * scale + 0.9} fontSize={5.5 * scale + 1.8} fontWeight="700" fill="#fff" textAnchor="middle">
                  {m.initials}
                </SvgText>
              )}
            </G>
          );
        })}

        {destPoint && !route?.here && <Pin at={destPoint} color={accent} scale={scale} />}

        {me && (
          <G>
            <AnimatedCircle cx={me.x} cy={me.y} fill={theme.tint} animatedProps={pulseProps} />
            <Circle cx={me.x} cy={me.y} r={6 * scale + 2} fill="#fff" />
            <Circle cx={me.x} cy={me.y} r={4 * scale + 1.5} fill={theme.tint} />
          </G>
        )}
      </Svg>
    </View>
  );
}

type Box = { x: number; y: number; w: number; h: number };

function ZoneShape({ zone, highlight, labels, scale, box }: { zone: VenueZone; highlight?: string; labels: boolean; scale: number; box: Box }) {
  const theme = useTheme();
  const s = zone.shape;
  const font = 7 * scale + 2.5;
  const at = s.kind === 'water' ? { x: s.x, y: s.y + 14 * scale + 6 }
    : s.kind === 'gate' ? { x: s.x, y: s.y - 9 * scale - 3 }
      : { x: s.x + s.w / 2, y: s.y + s.h / 2 + font / 3 };
  const x = labels ? fitLabel(zone.label, at, font, box, scale) : null;
  const label = x != null && (
    <SvgText
      fontFamily={MAP_FONT}
      x={x}
      y={at.y}
      fontSize={font}
      fontWeight={highlight ? '700' : '600'}
      fill={highlight ?? theme.textSecondary}
      textAnchor="middle">
      {zone.label}
    </SvgText>
  );
  const fill = highlight ? `${highlight}26` : theme.mapBuilding;
  const stroke = highlight ?? 'transparent';

  if (s.kind === 'water') {
    return (
      <G>
        <Circle cx={s.x} cy={s.y} r={6 * scale + 3} fill={highlight ?? '#6FA8F5'} stroke="#fff" strokeWidth={1.5} />
        {label}
      </G>
    );
  }
  if (s.kind === 'gate') {
    return (
      <G>
        <Rect x={s.x - 10} y={s.y - 4} width={20} height={8} rx={4} fill={highlight ?? theme.textTertiary} />
        {label}
      </G>
    );
  }
  return (
    <G>
      <Rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.kind === 'strip' ? s.h / 2 : 8} fill={fill} stroke={stroke} strokeWidth={1.5} />
      {label}
    </G>
  );
}

/**
 * Where to draw a zone label so it's never cut off at the map edge ("Backstag", "G"): nudged inside
 * when its anchor is on screen, hidden when the anchor isn't or there's no room. Width is estimated.
 */
function fitLabel(text: string, at: Point, font: number, box: Box, scale: number): number | null {
  const half = (text.length * font * 0.56) / 2;
  const inset = 4 * scale;
  const inside = at.x >= box.x && at.x <= box.x + box.w && at.y - font >= box.y && at.y + font * 0.3 <= box.y + box.h;
  if (!inside || half * 2 + inset * 2 > box.w) return null;
  return Math.min(Math.max(at.x, box.x + half + inset), box.x + box.w - half - inset);
}

function Pin({ at, color, scale, onPress }: { at: Point; color: string; scale: number; onPress?: () => void }) {
  const k = pinSize(scale);
  return (
    <G transform={`translate(${at.x} ${at.y}) scale(${k})`} {...pressable(onPress)}>
      <Circle r={16} fill={color} opacity={0.18} />
      <Path d="M0 0 C -4 -8, -12 -12, -12 -22 A 12 12 0 1 1 12 -22 C 12 -12, 4 -8, 0 0 Z" fill={color} stroke="#fff" strokeWidth={2} />
      <Circle cy={-22} r={4.5} fill="#fff" />
    </G>
  );
}

/** Grow the visible box by the covered fractions, so it lands in the uncovered part of the container. */
function framed(b: Box, frame?: { top: number; bottom: number }): Box {
  if (!frame) return b;
  const h = b.h / (1 - frame.top - frame.bottom);
  return { ...b, y: b.y - frame.top * h, h };
}

/** How big a task pin is drawn at a given zoom (see Pin). */
function pinSize(scale: number) {
  return 0.8 * scale + 0.35;
}

/**
 * Nudge markers apart until none overlap, so a crowd at one stage reads as separate people.
 * Pins are pushed by their head and stem, which sit above the point they mark. A few rounds of pairwise
 * pushes is plenty for a team-sized crowd.
 */
function spread(markers: MapMarker[], dot: number, pin: number): MapMarker[] {
  const lift = (m: MapMarker) => (m.kind === 'task' ? 14 * pin : 0);
  const c = markers.map((m) => ({ x: m.at.x, y: m.at.y - lift(m), r: m.kind === 'task' ? 17 * pin : dot }));
  for (let round = 0; round < 16; round++) {
    let moved = false;
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const dx = c[j].x - c[i].x, dy = c[j].y - c[i].y;
        const d = Math.hypot(dx, dy);
        const min = c[i].r + c[j].r + 3;
        if (d >= min) continue;
        // Exactly on top of each other: split along a fixed angle per pair so it's stable between renders.
        const [ux, uy] = d > 0.01 ? [dx / d, dy / d] : [Math.cos(i + j * 2.4), Math.sin(i + j * 2.4)];
        const push = (min - d) / 2;
        c[i].x -= ux * push; c[i].y -= uy * push;
        c[j].x += ux * push; c[j].y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return markers.map((m, i) => ({ ...m, at: { x: c[i].x, y: c[i].y + lift(m) } }) as MapMarker);
}

/**
 * Tap handlers for SVG shapes. On the web react-native-svg forwards responder props to the DOM,
 * which React rejects, so use a plain click there.
 */
function pressable(onPress?: () => void) {
  if (!onPress) return {};
  return (Platform.OS === 'web' ? { onClick: onPress } : { onPress }) as { onPress?: () => void };
}

/** Bounding box of the points, padded and stretched to the container's aspect ratio. */
function viewBoxFor(points: Point[], aspect: number): Box {
  if (points.length === 0) return fitAspect({ x: 0, y: 0, w: VENUE.width, h: VENUE.height }, aspect);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = 40;
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 160);
  const h = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2 + 16, 110); // extra headroom for the pin
  // Centre on the points, so a lone marker sits mid-map rather than hugging the left edge.
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 8;
  return fitAspect({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect);
}

function fitAspect(b: { x: number; y: number; w: number; h: number }, aspect: number) {
  if (b.w / b.h > aspect) {
    const h = b.w / aspect;
    return { ...b, y: b.y - (h - b.h) / 2, h };
  }
  const w = b.h * aspect;
  return { ...b, x: b.x - (w - b.w) / 2, w };
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});

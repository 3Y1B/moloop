import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { VoiceGradient } from '@/constants/theme';
import { EDGES, NODES, SCENERY, VENUE, VENUE_ZONES, type Point, type VenueZone } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';
import type { Route } from '@/lib/route';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MapPerson = { id: string; initials: string; color: string; at: Point };

type Props = {
  route: Route | null;
  /** Where I am (start of route, or my zone when there is no route). */
  me: Point | null;
  /** Destination zone slug, highlighted with a pin. */
  target?: string | null;
  targetColor?: string;
  /** Teammates to show as small initials. */
  people?: MapPerson[];
  /** Zoom to the route (cards) or show the whole site (navigation). */
  fit?: 'route' | 'site';
  /** Width ÷ height of the container, so the framed area fills it. */
  aspect: number;
  labels?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Stylised site plan with my position, the destination and the walking route. */
export function VenueMap({ route, me, target, targetColor, people = [], fit = 'route', aspect, labels = true, style }: Props) {
  const theme = useTheme();
  const dest = target ? VENUE_ZONES[target] : undefined;
  const destPoint = dest ? NODES[dest.node] : null;
  const pts = route?.points ?? [];

  const box = viewBoxFor(fit === 'site' ? [] : [...pts, ...(me ? [me] : []), ...(destPoint ? [destPoint] : [])], aspect);

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
  const routePoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const accent = targetColor ?? theme.danger;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.mapGround }, style]}>
      <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="route" x1="0" y1="0" x2="1" y2="1">
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
          <ZoneShape key={z.slug} zone={z} highlight={z.slug === target ? accent : undefined} labels={labels} scale={scale} />
        ))}

        {pts.length > 1 && (
          <>
            <Polyline points={routePoints} fill="none" stroke="url(#route)" strokeOpacity={0.35} strokeWidth={8 * scale + 2} strokeLinecap="round" strokeLinejoin="round" />
            <AnimatedPolyline
              points={routePoints}
              fill="none"
              stroke="url(#route)"
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
            <SvgText x={p.at.x} y={p.at.y + 2.6 * scale + 1} fontSize={6 * scale + 2} fontWeight="700" fill="#fff" textAnchor="middle">
              {p.initials}
            </SvgText>
          </G>
        ))}

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

function ZoneShape({ zone, highlight, labels, scale }: { zone: VenueZone; highlight?: string; labels: boolean; scale: number }) {
  const theme = useTheme();
  const s = zone.shape;
  const font = 7 * scale + 2.5;
  const at = s.kind === 'water' ? { x: s.x, y: s.y + 14 * scale + 6 }
    : s.kind === 'gate' ? { x: s.x, y: s.y - 9 * scale - 3 }
      : { x: s.x + s.w / 2, y: s.y + s.h / 2 + font / 3 };
  const label = labels && (
    <SvgText
      x={at.x}
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

function Pin({ at, color, scale }: { at: Point; color: string; scale: number }) {
  const k = 0.8 * scale + 0.35;
  return (
    <G transform={`translate(${at.x} ${at.y}) scale(${k})`}>
      <Circle r={16} fill={color} opacity={0.18} />
      <Path d="M0 0 C -4 -8, -12 -12, -12 -22 A 12 12 0 1 1 12 -22 C 12 -12, 4 -8, 0 0 Z" fill={color} stroke="#fff" strokeWidth={2} />
      <Circle cy={-22} r={4.5} fill="#fff" />
    </G>
  );
}

/** Bounding box of the points, padded and stretched to the container's aspect ratio. */
function viewBoxFor(points: Point[], aspect: number) {
  if (points.length === 0) return fitAspect({ x: 0, y: 0, w: VENUE.width, h: VENUE.height }, aspect);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = 40;
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad - 16; // extra headroom for the pin
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 160);
  const h = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2 + 16, 110);
  return fitAspect({ x, y, w, h }, aspect);
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

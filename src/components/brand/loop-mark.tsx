import { useEffect } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Brand } from '@/constants/theme';

/** The "oo" in moloop as one continuous loop. Same path as the app icon. */
const LOOP = 'M80 80 C92 54 124 54 124 80 C124 106 92 106 80 80 C68 54 36 54 36 80 C36 106 68 106 80 80 Z';
const LENGTH = 257;
const STROKE = 15;
/** The loop plus half a stroke on every side. */
const VIEW = { x: 28, y: 50, w: 104, h: 60 };
const SPARK = 52;

/** Height over width of the mark. */
const LOOP_RATIO = VIEW.h / VIEW.w;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  width?: number;
  color?: string;
  /** Draws itself in, then a highlight keeps travelling round the loop. Shorthand for `draw` + `spin`. */
  alive?: boolean;
  /** Draw the stroke in on mount. */
  draw?: boolean;
  /** Run the travelling highlight, so the mark doubles as the busy indicator. Toggles live. */
  spin?: boolean;
  /** One lap of the highlight, in ms. */
  lap?: number;
  sparkColor?: string;
};

export function LoopMark({
  width = 120,
  color = Brand.mist,
  alive = false,
  draw = alive,
  spin,
  lap = alive ? 3200 : 1400,
  sparkColor = '#FFFFFF',
}: Props) {
  const reduced = useReducedMotion();
  const spinning = spin ?? alive;
  const hasSpark = alive || spin !== undefined;

  const drawn = useSharedValue(draw && !reduced ? 0 : 1);
  const orbit = useSharedValue(0);
  const shown = useSharedValue(spinning ? 1 : 0);

  useEffect(() => {
    if (draw && !reduced) drawn.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
  }, [draw, reduced, drawn]);

  useEffect(() => {
    shown.value = withTiming(spinning ? 1 : 0, { duration: reduced ? 0 : 160 });
    if (spinning && !reduced) {
      orbit.value = 0;
      // Wait for the draw-in on first mount; later toggles start straight away.
      const lapping = withRepeat(withTiming(1, { duration: lap, easing: Easing.linear }), -1);
      orbit.value = drawn.value < 1 ? withDelay(900, lapping) : lapping;
    } else {
      cancelAnimation(orbit);
    }
  }, [spinning, reduced, lap, orbit, shown, drawn]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: LENGTH * (1 - drawn.value) }));
  const sparkProps = useAnimatedProps(() => ({
    strokeDashoffset: -LENGTH * orbit.value,
    strokeOpacity: shown.value * (drawn.value === 1 ? 1 : 0),
  }));

  return (
    <Svg width={width} height={width * LOOP_RATIO} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
      <AnimatedPath
        d={LOOP}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        strokeDasharray={[LENGTH, LENGTH]}
        animatedProps={lineProps}
      />
      {hasSpark && (
        <AnimatedPath
          d={LOOP}
          fill="none"
          stroke={sparkColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={[SPARK, LENGTH - SPARK]}
          animatedProps={sparkProps}
        />
      )}
    </Svg>
  );
}

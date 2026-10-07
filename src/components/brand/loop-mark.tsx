import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
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

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  width?: number;
  color?: string;
  /** Draws itself in, then a highlight keeps travelling round the loop. */
  alive?: boolean;
  sparkColor?: string;
};

export function LoopMark({ width = 120, color = Brand.mist, alive = false, sparkColor = '#FFFFFF' }: Props) {
  const drawn = useSharedValue(alive ? 0 : 1);
  const orbit = useSharedValue(0);

  useEffect(() => {
    if (!alive) return;
    drawn.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
    orbit.value = withDelay(900, withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1));
  }, [alive, drawn, orbit]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: LENGTH * (1 - drawn.value) }));
  const sparkProps = useAnimatedProps(() => ({
    strokeDashoffset: -LENGTH * orbit.value,
    strokeOpacity: drawn.value === 1 ? 1 : 0,
  }));

  return (
    <Svg width={width} height={(width * VIEW.h) / VIEW.w} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
      <AnimatedPath
        d={LOOP}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        strokeDasharray={[LENGTH, LENGTH]}
        animatedProps={lineProps}
      />
      {alive && (
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

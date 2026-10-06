import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/hooks/use-theme';

const SPRING = { damping: 32, stiffness: 320, mass: 0.9, overshootClamping: true };
export const SHEET_RADIUS = 22;

/**
 * The sheet over the full-screen map. `detents` are visible heights in px, lowest first.
 * Below the top detent the whole sheet drags; at the top the content scrolls, and pulling down
 * from the top of the content drags the sheet back down. `bottomInset` keeps content clear of
 * whatever is pinned over the sheet's bottom edge (the voice dock).
 */
export function BottomSheet({ detents, stop = 1, header, bottomInset = 0, children }: {
  detents: number[];
  /** Where the sheet rests. Changing it moves the sheet there (a new task arriving raises it). */
  stop?: number;
  /** Stays put above the scrolling content. */
  header?: ReactNode;
  bottomInset?: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const max = detents[detents.length - 1];
  const offsets = detents.map((d) => max - d);
  const top = offsets.length - 1;

  const y = useSharedValue(offsets[Math.min(stop, top)]);
  const start = useSharedValue(0);
  const moved = useSharedValue(false);
  const scrollY = useSharedValue(0);
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const [at, setAt] = useState(Math.min(stop, top));

  const snapTo = (index: number) => {
    'worklet';
    y.set(withSpring(offsets[index], SPRING));
    scheduleOnRN(setAt, index);
  };

  // New stops (rotation, a resized browser): stay on the same stop.
  const key = offsets.join();
  useEffect(() => {
    y.set(withSpring(offsets[Math.min(at, top)], SPRING));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [restingAt, setRestingAt] = useState(stop);
  if (stop !== restingAt) {
    setRestingAt(stop);
    setAt(Math.min(stop, top));
  }
  useEffect(() => {
    y.set(withSpring(offsets[Math.min(stop, top)], SPRING));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  const { native, pan } = useMemo(() => {
    const native = Gesture.Native();
    const pan = Gesture.Pan()
      .activeOffsetY([-6, 6])
      .failOffsetX([-24, 24])
      .simultaneousWithExternalGesture(native)
      .onBegin(() => {
        start.set(y.get());
        moved.set(false);
      })
      // Worklets run on the UI thread during the gesture, not during render; `scroll` is an animated ref made for this.
      // eslint-disable-next-line react-hooks/refs
      .onUpdate((e) => {
        // Open with the list scrolled down: the list has this drag. Re-anchor so the sheet picks up
        // smoothly once the list reaches its top.
        if (y.get() <= 0 && scrollY.get() > 0) {
          start.set(-e.translationY);
          return;
        }
        const next = Math.min(Math.max(start.get() + e.translationY, 0), offsets[0]);
        if (next > 0) scrollTo(scroll, 0, 0, false);
        if (next !== y.get()) moved.set(true);
        y.set(next);
      })
      .onEnd((e) => {
        if (!moved.get()) return;
        // Where a flick would carry it, then the nearest stop.
        const projected = y.get() + e.velocityY * 0.12;
        let best = 0;
        for (let i = 1; i < offsets.length; i++) {
          if (Math.abs(offsets[i] - projected) < Math.abs(offsets[best] - projected)) best = i;
        }
        snapTo(best);
      });
    return { native, pan };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: max, backgroundColor: theme.card, borderColor: theme.border },
        sheetStyle,
      ]}>
      <GestureDetector gesture={pan}>
        <View style={styles.flex}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={at === top ? 'Collapse' : 'Expand'}
            onPress={() => {
              Haptics.selectionAsync();
              snapTo(at === top ? Math.max(0, top - 1) : top);
            }}
            style={styles.grabberHit}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          </Pressable>
          {header}
          <GestureDetector gesture={native}>
            <Animated.ScrollView
              ref={scroll}
              onScroll={onScroll}
              scrollEventThrottle={16}
              scrollEnabled={at === top}
              bounces={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}>
              {children}
            </Animated.ScrollView>
          </GestureDetector>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    // Over a map, a hairline alone gets lost; this is the one soft shadow in the app.
    boxShadow: '0 -6px 24px rgba(17, 24, 39, 0.08)',
    overflow: 'hidden',
  },
  grabberHit: { alignItems: 'center', paddingTop: 8, paddingBottom: 10 },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  content: { paddingHorizontal: 20, gap: 16 },
});

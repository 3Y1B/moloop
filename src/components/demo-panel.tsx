import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInUp, FadeOut, FadeOutUp, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MapButton } from '@/components/map/map-button';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Segmented } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { useTopBarMetrics } from '@/components/ui/top-bar';
import { Radius, Shadow } from '@/constants/theme';
import { useMyDot } from '@/data/hooks';
import { getPinned, nudge, pin, refreshPin, subscribe } from '@/data/location';
import { signOut } from '@/data/supabase/client';
import { NODES, VENUE_ZONES } from '@/data/venue';
import { useTheme } from '@/hooks/use-theme';

/*
 * Testing tools, behind one button at the top right of every map: set my location by hand and walk it with a
 * joystick (no GPS, or nowhere near the site), and sign out to be someone else. The position goes to the server
 * like a GPS fix. The panel and the joystick float
 * over every screen, so they're drawn once at the root (DemoOverlay).
 */

let open = false;
const openListeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  open = next;
  openListeners.forEach((l) => l());
};
const onOpen = (l: () => void) => {
  openListeners.add(l);
  return () => {
    openListeners.delete(l);
  };
};

const usePinned = () => useSyncExternalStore(subscribe, () => getPinned() !== null);

export function DemoButton({ flat = false }: { flat?: boolean }) {
  return <MapButton label="Testing tools" sf="slider.horizontal.3" md="tune" flat={flat} onPress={() => setOpen(!open)} />;
}

/** The demo panel when it's open, and the joystick while my location is set by hand. */
export function DemoOverlay() {
  const shown = useSyncExternalStore(onOpen, () => open);
  const pinned = usePinned();
  const top = useTopBarMetrics().contentTop;
  return (
    <>
      {pinned && <Joystick top={top} />}
      {shown && (
        <>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]}>
            <Pressable accessibilityLabel="Close testing tools" style={styles.flex} onPress={() => setOpen(false)} />
          </Animated.View>
          <Panel top={top} />
        </>
      )}
    </>
  );
}

function Panel({ top }: { top: number }) {
  const theme = useTheme();
  const pinned = usePinned();
  const dot = useMyDot();

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(140)}
      style={[styles.panel, { top, backgroundColor: theme.card }]}>
      <Text variant="label">My location</Text>
      <Segmented
        segments={[{ key: 'gps', label: 'GPS' }, { key: 'joystick', label: 'Joystick' }]}
        value={pinned ? 'joystick' : 'gps'}
        onChange={(k) => pin(k === 'joystick' ? (dot ?? NODES[Object.values(VENUE_ZONES)[0].node]) : null)}
      />
      {pinned && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {Object.values(VENUE_ZONES).map((z) => (
            <Chip key={z.slug} label={z.label} onPress={() => pin(NODES[z.node])} />
          ))}
        </ScrollView>
      )}
      <Button
        label="Sign out"
        sf="rectangle.portrait.and.arrow.right"
        variant="tinted"
        size="small"
        onPress={() => {
          setOpen(false);
          pin(null);
          void signOut();
        }}
      />
    </Animated.View>
  );
}

const BASE = 96;
const KNOB = 36;
const REACH = (BASE - KNOB) / 2;
/** Full tilt, metres a second: a brisk walk, so crossing the site doesn't take all demo. */
const SPEED = 4;
const TICK_MS = 100;

/** Drag the knob to walk my pinned dot; screen up is up on the map. */
function Joystick({ top }: { top: number }) {
  const theme = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  useEffect(() => {
    const walk = setInterval(() => {
      const tx = x.value / REACH, ty = y.value / REACH;
      if (Math.hypot(tx, ty) < 0.1) return;
      const step = (SPEED * TICK_MS) / 1000;
      nudge(tx * step, ty * step);
    }, TICK_MS);
    const fresh = setInterval(refreshPin, 10_000);
    return () => {
      clearInterval(walk);
      clearInterval(fresh);
    };
  }, [x, y]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onUpdate((e) => {
      const d = Math.hypot(e.translationX, e.translationY);
      const k = d > REACH ? REACH / d : 1;
      x.value = e.translationX * k;
      y.value = e.translationY * k;
    })
    .onFinalize(() => {
      x.value = withSpring(0, { duration: 150 });
      y.value = withSpring(0, { duration: 150 });
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={[styles.base, { top, backgroundColor: theme.card, borderColor: theme.border }]}>
      <GestureDetector gesture={pan}>
        <View style={styles.pad}>
          <View style={[styles.track, { borderColor: theme.border }]} />
          <Animated.View style={[styles.knob, { backgroundColor: theme.tint, borderColor: theme.card }, knob]} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.08)' },
  panel: {
    position: 'absolute', right: 16, width: 280, padding: 12, gap: 10,
    borderRadius: Radius.card, borderCurve: 'continuous', ...Shadow.floating,
  },
  chips: { gap: 6 },
  base: {
    position: 'absolute', right: 16, width: BASE, height: BASE, borderRadius: BASE / 2,
    borderWidth: StyleSheet.hairlineWidth * 2, ...Shadow.floating,
  },
  pad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  track: {
    position: 'absolute', width: BASE - 24, height: BASE - 24, borderRadius: (BASE - 24) / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 3, ...Shadow.floating },
});

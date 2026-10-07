import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { haptic } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { Radius, Type } from '@/constants/theme';
import type { HandoverTarget, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Quiet text action under a step. */
function Back({ onPress }: { onPress: () => void }) {
  return <Button variant="plain" size="inline" tone="neutral" label="Back" haptic="none" onPress={onPress} style={styles.back} />;
}

export type Pickable = { volunteer: Volunteer; minutes: number | null; busy: boolean };

/** Backup or reassign: teammates on the map and here, best first. Tap one (here or on the map), then send. */
export function PickStep({ people, picked, onPick, reassign, onConfirm, onBack }: {
  people: Pickable[];
  picked: string | null;
  onPick: (id: string) => void;
  reassign: boolean;
  onConfirm: (id: string) => void;
  onBack: () => void;
}) {
  const chosen = people.find((p) => p.volunteer.id === picked);
  const name = chosen?.volunteer.name.split(' ')[0];
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      {people.length === 0 ? (
        <Text tone="secondary">No one on duty</Text>
      ) : (
        <View style={styles.chips}>
          {people.map(({ volunteer: v, minutes, busy }) => (
            <Chip
              key={v.id}
              label={v.name.split(' ')[0]}
              count={busy ? 'Busy' : minutes != null ? `${minutes} min` : undefined}
              selected={v.id === picked}
              accessibilityLabel={`${v.name}${busy ? ', busy' : ''}`}
              onPress={() => onPick(v.id)}
              style={styles.chip}
            />
          ))}
        </View>
      )}
      <Button
        size="large"
        label={!name ? (reassign ? 'Reassign' : 'Send backup') : reassign ? `Reassign to ${name}` : `Send ${name}`}
        haptic="success"
        disabled={!chosen}
        onPress={() => chosen && onConfirm(chosen.volunteer.id)}
      />
      <Back onPress={onBack} />
    </Animated.View>
  );
}

/** Medics or security; emergency services is its own step. */
export function HandoverStep({ onPick, onEmergency, onBack }: {
  onPick: (target: Exclude<HandoverTarget, 'emergency'>) => void;
  onEmergency: () => void;
  onBack: () => void;
}) {
  const tile = (target: Exclude<HandoverTarget, 'emergency'>, label: string) => (
    <Button variant="secondary" size="large" label={label} onPress={() => onPick(target)} style={styles.tile} />
  );
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      <View style={styles.tiles}>
        {tile('medics', 'First Aid medics')}
        {tile('security', 'Security')}
      </View>
      <Button
        variant="outline"
        size="large"
        tone="danger"
        label="Emergency services"
        trailingSf="chevron.right"
        trailingMd="chevron_right"
        onPress={onEmergency}
      />
      <Back onPress={onBack} />
    </Animated.View>
  );
}

const HOLD_MS = 1200;

/** Emergency services are human-only: the lead calls 000 themselves, then holds to record it. Letting go early cancels. */
export function EmergencyStep({ where, onCalled, onBack }: { where: string; onCalled: () => void; onBack: () => void }) {
  const theme = useTheme();
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const fill = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  const start = () => {
    // Heavier than any tap: this is the 000 hold.
    haptic('heavy');
    progress.set(withTiming(1, { duration: HOLD_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
    timer.current = setTimeout(() => {
      timer.current = null;
      haptic('warning');
      onCalled();
    }, HOLD_MS);
  };
  const end = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: 180 }));
  };

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      <Text variant="hero" tone="danger" style={styles.zeros}>Call 000</Text>
      {!!where && <Text>{where}</Text>}
      <Pressable
        onPressIn={start}
        onPressOut={end}
        accessibilityRole="button"
        accessibilityLabel="Hold: called 000"
        style={[styles.holdable, { borderColor: theme.danger }]}>
        <Animated.View style={[styles.fill, { backgroundColor: theme.dangerSoft }, fill]} />
        <Text tone="danger" style={styles.strong}>Hold · Called 000</Text>
      </Pressable>
      <Back onPress={onBack} />
    </Animated.View>
  );
}

/** Close: an optional reason, then close. */
export function CloseStep({ onClose, onBack }: { onClose: (note?: string) => void; onBack: () => void }) {
  const theme = useTheme();
  const [note, setNote] = useState('');
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      <View style={[styles.input, { backgroundColor: theme.backgroundElement }]}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Reason (optional)"
          placeholderTextColor={theme.textTertiary}
          returnKeyType="done"
          style={[styles.inputText, { color: theme.text }]}
        />
      </View>
      <Button size="large" label="Close task" haptic="warning" onPress={() => onClose(note.trim() || undefined)} />
      <Back onPress={onBack} />
    </Animated.View>
  );
}

/** A handover is on its way: Arrived frees the volunteer. */
export function ArrivedStep({ onArrived }: { onArrived: () => void }) {
  return <Button size="large" label="Arrived" sf="checkmark.circle.fill" haptic="success" onPress={onArrived} />;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1 },
  // Held, not tapped: the outline fills as the hold runs, so it can't be a Button.
  holdable: {
    height: 56,
    overflow: 'hidden',
    borderRadius: Radius.control,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, pointerEvents: 'none' },
  strong: { fontWeight: '600' },
  zeros: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -0.5 },
  back: { alignSelf: 'center', paddingVertical: 4 },
  input: { height: 48, borderRadius: Radius.control, borderCurve: 'continuous', paddingHorizontal: 14, justifyContent: 'center' },
  inputText: { fontSize: Type.body, padding: 0 },
});

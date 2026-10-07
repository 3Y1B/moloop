import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import type { HandoverTarget, Volunteer } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** Quiet text action under a step. */
function Back({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} hitSlop={8} style={styles.back}>
      <Text style={[styles.backText, { color: theme.textSecondary }]}>Back</Text>
    </Pressable>
  );
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
  const theme = useTheme();
  const chosen = people.find((p) => p.volunteer.id === picked);
  const name = chosen?.volunteer.name.split(' ')[0];
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      {people.length === 0 ? (
        <Text style={[styles.body, { color: theme.textSecondary }]}>No one on duty</Text>
      ) : (
        <View style={styles.chips}>
          {people.map(({ volunteer: v, minutes, busy }) => {
            const on = v.id === picked;
            return (
              <Pressable
                key={v.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${v.name}${busy ? ', busy' : ''}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  onPick(v.id);
                }}
                style={[
                  styles.chip,
                  { backgroundColor: on ? theme.tintSoft : theme.backgroundElement, borderColor: on ? theme.tint : 'transparent' },
                ]}>
                <Text style={[styles.chipName, { color: on ? theme.tint : busy ? theme.textTertiary : theme.text }]} numberOfLines={1}>
                  {v.name.split(' ')[0]}
                </Text>
                <Text style={[styles.chipMeta, { color: on ? theme.tint : theme.textSecondary }]} numberOfLines={1}>
                  {busy ? 'Busy' : minutes != null ? `${minutes} min` : ' '}
                </Text>
              </Pressable>
            );
          })}
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
  const theme = useTheme();
  const tile = (target: Exclude<HandoverTarget, 'emergency'>, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        Haptics.selectionAsync();
        onPick(target);
      }}
      style={({ pressed }) => [styles.tile, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.tileText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
      <View style={styles.tiles}>
        {tile('medics', 'First Aid medics')}
        {tile('security', 'Security')}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Emergency services"
        onPress={() => {
          Haptics.selectionAsync();
          onEmergency();
        }}
        style={({ pressed }) => [styles.outline, { borderColor: theme.danger, opacity: pressed ? 0.7 : 1 }]}>
        <Text style={[styles.outlineText, { color: theme.danger }]}>Emergency services</Text>
        <Icon sf="chevron.right" md="chevron_right" size={14} color={theme.danger} weight="semibold" />
      </Pressable>
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    progress.set(withTiming(1, { duration: HOLD_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
    timer.current = setTimeout(() => {
      timer.current = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
      <Text style={[styles.zeros, { color: theme.danger }]}>Call 000</Text>
      {!!where && <Text style={[styles.body, { color: theme.text }]}>{where}</Text>}
      <Pressable
        onPressIn={start}
        onPressOut={end}
        accessibilityRole="button"
        accessibilityLabel="Hold: called 000"
        style={[styles.outline, styles.holdable, { borderColor: theme.danger }]}>
        <Animated.View style={[styles.fill, { backgroundColor: theme.dangerSoft }, fill]} />
        <Text style={[styles.outlineText, { color: theme.danger }]}>Hold · Called 000</Text>
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
  body: { fontSize: Type.body },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    height: 56,
    paddingHorizontal: 6,
    borderRadius: Radius.control,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  chipName: { fontSize: Type.callout, fontWeight: '600' },
  chipMeta: { fontSize: Type.caption, fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, height: 64, borderRadius: Radius.card, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: Type.body, fontWeight: '600' },
  outline: {
    height: 52,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { fontSize: Type.body, fontWeight: '600' },
  holdable: { height: 56, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, pointerEvents: 'none' },
  zeros: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -0.5 },
  back: { alignSelf: 'center', paddingVertical: 4 },
  backText: { fontSize: Type.callout, fontWeight: '600' },
  input: { height: 48, borderRadius: Radius.control, borderCurve: 'continuous', paddingHorizontal: 14, justifyContent: 'center' },
  inputText: { fontSize: Type.body, padding: 0 },
});

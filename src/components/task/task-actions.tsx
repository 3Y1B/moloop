import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { useDockHeight } from '@/components/voice/voice-dock';
import { Type } from '@/constants/theme';
import { useMe, useMyWork, useRepo } from '@/data/hooks';
import { REPLY_LABEL } from '@/lib/format';
import { availableHelperReplies, availableReplies } from '@/lib/lifecycle';
import type { HelperAssignment, ReplyKind, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { useSendReply } from './reply-bar';

/**
 * The next tap, pinned between the sheet and the voice field so it stays under the thumb at every stop:
 * one filled button, the alternative as text.
 * Free, it's only there on a break (Back on duty). `onHeight` lets the sheet keep its content clear of it.
 */
export function TaskActions({ onHeight }: { onHeight: (height: number) => void }) {
  const { active } = useMyWork();
  const me = useMe();
  const helperEntry = active && me ? active.helpers.find((helper) => helper.volunteerId === me.id) : undefined;
  const dock = useDockHeight();
  const onBreak = !!me && me.duty !== 'on_duty';
  if (!active && !onBreak) return null;
  return (
    <Animated.View
      key={active?.id ?? 'break'}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(120)}
      onLayout={(e) => onHeight(Math.ceil(e.nativeEvent.layout.height))}
      style={[styles.bar, { bottom: dock }]}>
      <Surface>{active ? <Replies task={active} helperEntry={helperEntry} /> : <BackOnDuty />}</Surface>
    </Animated.View>
  );
}

function Surface({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.surface, { backgroundColor: theme.card }]}>{children}</View>;
}

function Replies({ task, helperEntry }: { task: Task; helperEntry?: HelperAssignment }) {
  const send = useSendReply(task);
  const { primary, secondary } = helperEntry
    ? availableHelperReplies(helperEntry.status)
    : availableReplies(task.status);
  // Notified helpers must accept/decline their own slot before they can finish it.
  // "Still on it" lives in the status line and in voice.
  const alt = secondary.find((r) => r !== 'still_on_it');
  // Words for a festival-goer go through the assistant ("Update your task"), so there's no Reply button here.
  if (!primary) return null;

  return (
    <View style={styles.row}>
      <Button
        size="large"
        label={REPLY_LABEL[primary]}
        haptic={primary === 'done' ? 'success' : 'light'}
        onPress={() => send(primary)}
        style={styles.flex}
      />
      {alt && <TextAction kind={alt} onPress={() => send(alt)} />}
    </View>
  );
}

/** The alternative to the main reply, as text: Need help in red, Decline quiet. */
function TextAction({ kind, onPress }: { kind: ReplyKind; onPress: () => void }) {
  const theme = useTheme();
  const color = kind === 'need_help' ? theme.danger : theme.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onPress();
      }}
      hitSlop={6}
      style={({ pressed }) => [styles.text, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[styles.textLabel, { color }]}>{REPLY_LABEL[kind]}</Text>
    </Pressable>
  );
}

function BackOnDuty() {
  const repo = useRepo();
  return <Button size="large" label="Back on duty" onPress={() => repo.setDuty('on_duty')} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { position: 'absolute', left: 0, right: 0 },
  // The voice dock fades the 20pt above it into the sheet; the bottom padding keeps the buttons out of that fade.
  surface: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { height: 48, paddingHorizontal: 14, justifyContent: 'center' },
  textLabel: { fontSize: Type.body + 1, fontWeight: '600' },
});

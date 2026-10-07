import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { useDockHeight } from '@/components/voice/voice-dock';
import { useMe, useMyWork, useRepo } from '@/data/hooks';
import type { HelperAssignment, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { useReplyOptions } from './reply-options';

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
  // Notified helpers must accept/decline their own slot before they can finish it.
  // Words for a festival-goer go through the assistant ("Update your task"), so there's no Reply button here.
  const { primary, alternatives: all } = useReplyOptions(task, helperEntry);
  const alternatives = all.filter((o) => o.key !== 'guest_reply').slice(0, 1);
  if (!primary) return null;
  return (
    <View style={styles.row}>
      <Button size="large" label={primary.label} haptic={primary.haptic} onPress={primary.onPress} style={styles.flex} />
      {/* The alternative as text: Need help in red, Decline quiet. */}
      {alternatives.map((o) => (
        <Button
          key={o.key}
          variant="plain"
          size="large"
          label={o.label}
          tone={o.tone}
          haptic={o.haptic}
          onPress={o.onPress}
          style={styles.text}
        />
      ))}
    </View>
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
  text: { paddingHorizontal: 12 },
});

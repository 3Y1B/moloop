import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { LiveTranscript, useSimulatedTranscript } from '@/components/voice/live-transcript';
import { Orb } from '@/components/voice/orb';
import { Radius, Type } from '@/constants/theme';
import { useRepo, useSnapshot } from '@/data/hooks';
import { REPLY_SF } from '@/lib/format';
import type { ReplyKind } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type NoteReply = Extract<ReplyKind, 'done' | 'need_help' | 'still_on_it'>;

// `demo`/`more` stand in for STT until audio lands (same `{guess|final}` format as the Talk tab).
const COPY: Record<NoteReply, { prompt: string; send: string; demo: string; more: string }> = {
  done: {
    prompt: 'What did you do?',
    send: 'Mark done',
    demo: 'gave him some water and, um, sat him in the shade. he’s {filling|feeling} better now',
    more: 'his friends are, uh, staying with him',
  },
  need_help: {
    prompt: 'What do you need?',
    send: 'Get help',
    demo: 'he’s, uh, not looking great, can a {medical|medic} come over',
    more: 'he’s by the, um, the blue {tend|tent}',
  },
  still_on_it: {
    prompt: 'How’s it going?',
    send: 'Send update',
    demo: 'still with him, waiting for him to cool down a {bet|bit}',
    more: 'should be, um, five more {mins|minutes}',
  },
};

/** Done, Need help and check-ins all carry a few words: said or typed, then sent with the reply. */
export default function ReplySheet() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: NoteReply }>();
  const theme = useTheme();
  const repo = useRepo();
  const task = useSnapshot().tasks[id];
  const [note, setNote] = useState('');
  const [script, setScript] = useState<string | null>(null);
  const stream = useSimulatedTranscript(script);
  const copy = COPY[kind];
  if (!task || !copy) return null;

  const listening = script != null;
  // Asking for help never waits on words; the others are what the lead reads back later.
  const canSend = kind === 'need_help' || note.trim().length > 0;
  const color = kind === 'need_help' ? theme.danger : kind === 'done' ? theme.success : theme.tint;

  const send = async () => {
    await repo.reply(task.id, kind, note.trim() || undefined);
    router.back();
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <Text style={[styles.task, { color: theme.textSecondary }]} numberOfLines={1}>{task.title}</Text>
      <Text style={[styles.prompt, { color: theme.text }]}>{copy.prompt}</Text>

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: listening ? theme.tint : theme.border }]}>
        {listening ? (
          <LiveTranscript tokens={stream.tokens} before={note} style={styles.text} />
        ) : (
          <TextInput
            multiline
            value={note}
            onChangeText={setNote}
            placeholder="Hold to talk or type"
            placeholderTextColor={theme.textTertiary}
            style={[styles.text, styles.input, { color: theme.text }]}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hold to talk"
        onPressIn={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setScript(note.trim() ? copy.more : copy.demo);
        }}
        onPressOut={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          // Whatever was heard by the time you let go joins what's already there, and stays editable.
          const heard = stream.text.trim();
          if (heard) setNote((n) => (n.trim() ? `${n.trim()} ${heard}` : heard));
          setScript(null);
        }}
        style={({ pressed }) => [styles.orb, { transform: [{ scale: pressed ? 1.06 : 1 }] }]}>
        <Orb size={64} state={listening ? 'listening' : 'idle'} />
      </Pressable>

      <Button
        size="large"
        label={copy.send}
        sf={REPLY_SF[kind]}
        color={color}
        haptic={kind === 'need_help' ? 'warning' : 'success'}
        disabled={!canSend || listening}
        onPress={send}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 28, gap: 12 },
  task: { fontSize: Type.footnote, fontWeight: '500' },
  prompt: { fontSize: Type.title, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2, marginTop: -6 },
  card: { minHeight: 104, padding: 14, borderRadius: Radius.card, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2 },
  text: { fontSize: Type.body, lineHeight: 21 },
  input: { flex: 1, padding: 0, textAlignVertical: 'top' },
  orb: { alignSelf: 'center', marginVertical: 4 },
});

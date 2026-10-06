import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { LiveTranscript, useSimulatedTranscript } from '@/components/voice/live-transcript';
import { VoicePill } from '@/components/voice/voice-pill';
import { Radius, Type } from '@/constants/theme';
import { useRepo, useSnapshot } from '@/data/hooks';
import { REPLY_SF } from '@/lib/format';
import type { ReplyKind } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type NoteReply = Extract<ReplyKind, 'done' | 'need_help' | 'still_on_it'>;
/** A reply to the volunteer's own task, or `guest_reply`: a note into the festival-goer's thread. */
type SheetKind = NoteReply | 'guest_reply';

// `demo`/`more` stand in for STT until audio lands (same `{guess|final}` format as the voice dock).
const COPY: Record<SheetKind, { prompt: string; send: string; sf: string; demo: string; more: string }> = {
  done: {
    prompt: 'What did you do?',
    send: 'Mark done',
    sf: REPLY_SF.done,
    demo: 'gave him some water and, um, sat him in the shade. he’s {filling|feeling} better now',
    more: 'his friends are, uh, staying with him',
  },
  need_help: {
    prompt: 'What’s going on?',
    send: 'Ask for help',
    sf: REPLY_SF.need_help,
    demo: 'he’s, uh, getting worse, can a {medical|medic} come over',
    more: 'he’s by the, um, the blue {tend|tent}',
  },
  still_on_it: {
    prompt: 'How’s it going?',
    send: 'Send update',
    sf: REPLY_SF.still_on_it,
    demo: 'still with him, waiting for him to cool down a {bet|bit}',
    more: 'should be, um, five more {mins|minutes}',
  },
  guest_reply: {
    prompt: 'Reply',
    send: 'Send reply',
    sf: 'paperplane.fill',
    demo: 'hi, I’m on my {weigh|way}, about two minutes',
    more: 'look for the, um, the blue {vast|vest}',
  },
};

/**
 * Done, Need help and check-ins all carry a few words: said or typed, then sent with the reply.
 * Need help sends straight away if you skip the reason. `guest_reply` goes to the festival-goer's thread.
 */
export default function ReplySheet() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: SheetKind }>();
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
    if (kind === 'guest_reply') await repo.guestReply(task.id, note.trim());
    else await repo.reply(task.id, kind, note.trim() || undefined);
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

      {/* Replying to a festival-goer: what they said, so the reply answers it. */}
      {kind === 'guest_reply' && (
        <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.quoteText, { color: theme.textSecondary }]}>“{task.reporter.quote}”</Text>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: listening ? theme.tint : theme.border }]}>
        {listening ? (
          <LiveTranscript tokens={stream.tokens} before={note} style={styles.text} />
        ) : (
          <TextInput
            multiline
            value={note}
            onChangeText={setNote}
            placeholder={kind === 'need_help' ? 'Optional' : 'Type, or hold to talk'}
            placeholderTextColor={theme.textTertiary}
            style={[styles.text, styles.input, { color: theme.text }]}
          />
        )}
      </View>

      <View style={styles.pill}>
        <VoicePill
          listening={listening}
          placeholder={note.trim() ? 'Hold to add more' : 'Hold to talk'}
          onHoldStart={() => setScript(note.trim() ? copy.more : copy.demo)}
          onHoldEnd={() => {
            // Whatever was heard by the time you let go joins what's already there, and stays editable.
            const heard = stream.text.trim();
            if (heard) setNote((n) => (n.trim() ? `${n.trim()} ${heard}` : heard));
            setScript(null);
          }}
        />
      </View>

      <Button
        size="large"
        label={copy.send}
        sf={copy.sf}
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
  pill: { flexDirection: 'row' },
  quote: { borderRadius: Radius.control - 2, borderCurve: 'continuous', padding: 10 },
  quoteText: { fontSize: Type.callout - 1, lineHeight: 18, fontStyle: 'italic' },
});

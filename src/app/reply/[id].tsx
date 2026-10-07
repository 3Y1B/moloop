import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Sheet, SheetTitle } from '@/components/lead/sheet';
import { Button } from '@/components/ui/button';
import { Text, textStyle } from '@/components/ui/text';
import { useHoldToTalk } from '@/components/voice/use-hold-to-talk';
import { VoicePill } from '@/components/voice/voice-pill';
import { Radius } from '@/constants/theme';
import { useLookups, useRepo, useSnapshot } from '@/data/hooks';
import { REPLY_SF } from '@/lib/format';
import { goBack } from '@/lib/navigation';
import type { ReplyKind } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type NoteReply = Extract<ReplyKind, 'done' | 'need_help' | 'still_on_it'>;
/**
 * A reply to the volunteer's own task; `guest_reply`, a note into the festival-goer's thread; or `crew_message`, a
 * lead's words to whoever is on the task.
 */
type SheetKind = NoteReply | 'guest_reply' | 'crew_message';

const COPY: Record<SheetKind, { prompt: string; send: string; sf: string }> = {
  done: { prompt: 'What did you do?', send: 'Mark done', sf: REPLY_SF.done },
  need_help: { prompt: 'What’s going on?', send: 'Ask for help', sf: REPLY_SF.need_help },
  still_on_it: { prompt: 'How’s it going?', send: 'Send update', sf: REPLY_SF.still_on_it },
  guest_reply: { prompt: 'Reply', send: 'Send reply', sf: 'paperplane.fill' },
  crew_message: { prompt: 'Message', send: 'Send', sf: 'paperplane.fill' },
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
  const { volunteers } = useLookups();
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const hold = useHoldToTalk();
  const copy = COPY[kind];
  if (!task || !copy) return null;
  const owner = task.assigneeId ? volunteers[task.assigneeId] : undefined;
  const prompt = kind === 'crew_message' && owner ? `Message ${owner.name.split(' ')[0]}` : copy.prompt;

  const listening = hold.state !== 'idle';
  // Asking for help never waits on words; the others are what the lead reads back later.
  const canSend = kind === 'need_help' || note.trim().length > 0;
  const color = kind === 'need_help' ? theme.danger : kind === 'done' ? theme.success : theme.tint;

  const send = async () => {
    if (kind === 'guest_reply') await repo.guestReply(task.id, note.trim());
    else if (kind === 'crew_message') await repo.messageCrew(task.id, note.trim());
    else await repo.reply(task.id, kind, note.trim() || undefined);
    goBack({ pathname: '/task/[id]', params: { id: task.id } });
  };

  return (
    <Sheet>
      <SheetTitle eyebrow={task.title} title={prompt} />

      {/* Replying to a festival-goer: what they said, so the reply answers it. */}
      {kind === 'guest_reply' && (
        <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
          <Text tone="secondary" style={styles.quoteText}>“{task.reporter.quote}”</Text>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.card, borderColor: listening ? theme.tint : theme.border }]}>
        {listening ? (
          <Text>
            {!!note.trim() && <Text>{note.trim()} </Text>}
            <Text tone="tertiary">{hold.state === 'hearing' ? '…' : note.trim() ? '' : 'Go ahead…'}</Text>
          </Text>
        ) : (
          <TextInput
            multiline
            value={note}
            onChangeText={setNote}
            placeholder={kind === 'need_help' ? 'Optional' : 'Type, or hold to talk'}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text }]}
          />
        )}
      </View>

      {!!problem && <Text variant="footnote" tone="secondary" style={styles.center}>{problem}</Text>}

      <View style={styles.pill}>
        <VoicePill
          listening={hold.state === 'recording'}
          level={hold.level}
          placeholder={note.trim() ? 'Hold to add more' : 'Hold to talk'}
          disabled={hold.state === 'hearing'}
          onHoldStart={() => {
            setProblem(null);
            hold.start();
          }}
          onHoldEnd={async () => {
            // What was heard joins what's already there, and stays editable.
            try {
              const heard = (await hold.stop())?.text.trim();
              if (heard) setNote((n) => (n.trim() ? `${n.trim()} ${heard}` : heard));
              else setProblem('Didn’t catch that');
            } catch (e) {
              console.warn('[voice] transcribe failed', e);
              setProblem('Voice is down. Type instead.');
            }
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
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 104, padding: 14, borderRadius: Radius.card, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2 },
  input: { ...textStyle('body'), flex: 1, padding: 0, textAlignVertical: 'top' },
  pill: { flexDirection: 'row' },
  center: { textAlign: 'center' },
  quote: { borderRadius: Radius.control - 2, borderCurve: 'continuous', padding: 10 },
  quoteText: { ...textStyle('footnote'), lineHeight: 18, fontStyle: 'italic' },
});

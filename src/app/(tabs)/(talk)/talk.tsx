import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrioritySignal } from '@/components/task/badges';
import { Button } from '@/components/ui/button';
import { Canvas } from '@/components/ui/canvas';
import { CircleButton } from '@/components/ui/circle-button';
import { Icon } from '@/components/ui/icon';
import { LiveTranscript, useSimulatedTranscript, type Token } from '@/components/voice/live-transcript';
import { Orb } from '@/components/voice/orb';
import { Waveform } from '@/components/voice/waveform';
import { BottomTabInset, Radius, Type } from '@/constants/theme';
import { useLookups, useMe, useMyWork, useNow, useRepo } from '@/data/hooks';
import type { Interpretation } from '@/data/repo';
import { ago, REPLY_LABEL, REPLY_SF } from '@/lib/format';
import type { ReplyKind, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

type Phase =
  | { kind: 'idle' }
  /** `before` is the review we came from when you hold again to keep talking; new words append to it. */
  | { kind: 'listening'; script: string; before?: Interpretation }
  | { kind: 'review'; interpretation: Interpretation }
  | { kind: 'sent'; text: string };

type Said = { id: number; heard: string; result: string; at: number };

// Until expo-audio + streaming STT land, holding streams a plausible line for the current state.
// Written the way people actually talk into a radio mid-shift: filler, restarts, trailing off.
// `{guess|final}` is a word the recogniser first mishears, then corrects.
const DEMO_LINE: Record<string, string> = {
  assigned: 'uh yeah got it, {hitting|heading} over now',
  accepted: 'ok he’s, um, he’s {salted|sorted} now. done',
  in_progress: 'ok he’s, um, he’s {salted|sorted} now. done',
  escalated: 'all done, {paramedic|paramedics} have taken over',
  none: 'hey um there’s a, there’s like a spill near the uh river {state|stage} bar, by the, it’s pretty {slippy|slippery}, someone’s gonna',
};

/** What the demo says when you hold again after the line already ran out. */
const DEMO_MORE = 'oh and, um, it’s right {buy|by} the bins near the {fans|fence}';

/**
 * Simulated "keep talking": if you were cut off partway through the demo line, pick up from the
 * next word; otherwise say something extra. Real STT just keeps listening, so this goes away with it.
 */
function continueScript(script: string, heard: string) {
  const words = script.split(/\s+/).filter(Boolean);
  const finals = words.map((w) => w.replace(/^\{[^|]+\|([^}]+)\}/, '$1'));
  const said = heard.split(/\s+/).filter(Boolean);
  const cutOff = said.length < words.length && said.every((w, i) => w === finals[i]);
  return cutOff ? words.slice(said.length).join(' ') : DEMO_MORE;
}

/** What Send will actually do, in plain words. Nothing here claims a result we don't have yet. */
const REPLY_EFFECT: Record<ReplyKind, (title: string) => string> = {
  accept: (t) => `Accepts “${t}”.`,
  decline: (t) => `Declines “${t}” so it goes to someone else.`,
  done: (t) => `Marks “${t}” as done.`,
  need_help: (t) => `Tells your lead you need help with “${t}”.`,
  still_on_it: (t) => `Tells your lead you’re still on “${t}”.`,
};

const STATUS: Record<Phase['kind'], string> = {
  idle: 'Hold to talk',
  listening: 'Listening…',
  review: 'Hold to keep talking',
  sent: 'Sent',
};

/** Voice mode: one orb, one transcript, nothing sent until you confirm what we heard. */
export default function TalkScreen() {
  const theme = useTheme();
  const repo = useRepo();
  const { active } = useMyWork();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Said[]>([]);

  const interpret = async (text: string) => {
    if (!text.trim()) return setPhase({ kind: 'idle' });
    setPhase({ kind: 'review', interpretation: await repo.interpret(text) });
  };

  const send = async (i: Interpretation) => {
    const { confirmation } = await repo.commit(i);
    setHistory((h) => [{ id: Date.now(), heard: i.heard, result: confirmation, at: Date.now() }, ...h].slice(0, 6));
    setPhase({ kind: 'sent', text: confirmation });
    setTimeout(() => setPhase((p) => (p.kind === 'sent' ? { kind: 'idle' } : p)), 2500);
  };

  const listening = phase.kind === 'listening';
  const before = phase.kind === 'listening' ? phase.before : undefined;
  const stream = useSimulatedTranscript(phase.kind === 'listening' ? phase.script : null);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.flex}>
      <Canvas />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + BottomTabInset + 20 }]}>
        <Context task={active} />

        <View style={styles.stage}>
          {showHistory ? (
            <History items={history} />
          ) : phase.kind === 'review' ? (
            <Heard interpretation={phase.interpretation} task={active} onSend={send} onCancel={() => setPhase({ kind: 'idle' })} />
          ) : phase.kind === 'sent' ? (
            <Animated.View entering={FadeIn} style={styles.center}>
              <Icon sf="checkmark.circle.fill" md="check_circle" size={34} color={theme.success} />
              <Text style={[styles.sentText, { color: theme.text }]}>{phase.text}</Text>
            </Animated.View>
          ) : listening ? (
            <Animated.View key="listening" entering={FadeIn.duration(160)}>
              <Live tokens={stream.tokens} before={before?.heard} />
            </Animated.View>
          ) : (
            <Animated.View key="idle" entering={FadeIn} exiting={FadeOut}>
              <Text style={[styles.prompt, { color: theme.text }]}>
                {!active ? 'Report an issue'
                  : active.status === 'assigned' ? 'Accept or decline'
                    : 'Update your task'}
              </Text>
            </Animated.View>
          )}
        </View>

        {typing && (
          <Animated.View entering={FadeInDown.duration(200)} style={[styles.typeRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <TextInput
              autoFocus
              value={typed}
              onChangeText={setTyped}
              placeholder={!active ? 'Report an issue' : active.status === 'assigned' ? 'Accept or decline' : 'Update your task'}
              placeholderTextColor={theme.textTertiary}
              style={[styles.input, { color: theme.text }]}
              returnKeyType="send"
              onSubmitEditing={() => {
                interpret(typed);
                setTyped('');
                setTyping(false);
              }}
            />
          </Animated.View>
        )}

        <Text style={[styles.status, { color: listening ? theme.tint : theme.textTertiary }]}>{STATUS[phase.kind]}</Text>

        <View style={styles.controls}>
          <CircleButton label={showHistory ? 'Hide history' : 'What you said'} onPress={() => setShowHistory((s) => !s)}>
            <Icon sf={showHistory ? 'xmark' : 'clock.arrow.circlepath'} md={showHistory ? 'close' : 'history'} size={17} color={theme.textSecondary} />
          </CircleButton>
          <Waveform active={listening} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={phase.kind === 'review' ? 'Hold to keep talking' : 'Hold to talk'}
            onPressIn={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowHistory(false);
              const script = DEMO_LINE[active?.status ?? 'none'] ?? DEMO_LINE.none;
              // Holding again from review keeps what you already said and adds to it, as many times as you like.
              if (phase.kind === 'review') {
                const prev = phase.interpretation;
                setPhase({ kind: 'listening', script: continueScript(script, prev.heard), before: prev });
              } else {
                setPhase({ kind: 'listening', script });
              }
            }}
            onPressOut={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // Whatever was heard by the time you let go is what we interpret; nothing heard → back to where you were.
              if (before && !stream.text.trim()) return setPhase({ kind: 'review', interpretation: before });
              interpret(before ? `${before.heard} ${stream.text}` : stream.text);
            }}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 1.06 : 1 }] })}>
            <Orb size={84} state={listening ? 'listening' : 'idle'} />
          </Pressable>
          <Waveform active={listening} mirrored />
          <CircleButton label="Type instead" onPress={() => setTyping((t) => !t)}>
            <Icon sf={typing ? 'keyboard.chevron.compact.down' : 'keyboard'} md="keyboard" size={17} color={theme.textSecondary} />
          </CircleButton>
        </View>

      </ScrollView>
    </View>
  );
}

function Context({ task }: { task: Task | undefined }) {
  const theme = useTheme();
  return (
    <View style={[styles.context, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {task ? (
        <>
          <PrioritySignal priority={task.priority} size={11} />
          <Text style={[styles.contextText, { color: theme.textSecondary }]} numberOfLines={1}>
            Replying about <Text style={{ color: theme.text, fontWeight: '600' }}>{task.title}</Text>
          </Text>
        </>
      ) : (
        <>
          <Icon sf="plus.bubble.fill" md="add_comment" size={12} color={theme.tint} />
          <Text style={[styles.contextText, { color: theme.textSecondary }]}>New report</Text>
        </>
      )}
    </View>
  );
}

/** The caption card while you hold: same card the "Heard" echo uses, so release feels continuous. */
function Live({ tokens, before }: { tokens: Token[]; before?: string }) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  return (
    <View style={[styles.heardCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.heardLabel, { color: theme.tint }]}>Listening</Text>
      <ScrollView ref={scroll} style={styles.heardScroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {tokens.length || before ? (
          <LiveTranscript tokens={tokens} before={before} style={styles.heardText} />
        ) : (
          <Text style={[styles.heardText, { color: theme.textTertiary }]}>Go ahead…</Text>
        )}
      </ScrollView>
    </View>
  );
}

/** The "Heard: …" echo: the raw transcript, then exactly what Send will do. Nothing happens until Send. */
function Heard({ interpretation, task, onSend, onCancel }: {
  interpretation: Interpretation;
  task: Task | undefined;
  onSend: (i: Interpretation) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const me = useMe();
  const { zones } = useLookups();
  const { intent } = interpretation;
  const reply = intent.kind === 'reply' ? intent.reply : null;
  const where = me?.zoneSlug ? zones[me.zoneSlug]?.name : undefined;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.heard}>
      <View style={[styles.heardCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.heardLabel, { color: theme.textTertiary }]}>Heard</Text>
        <ScrollView style={styles.heardScroll} nestedScrollEnabled>
          <Text style={[styles.heardText, { color: theme.text }]} selectable>{interpretation.heard}</Text>
        </ScrollView>
      </View>
      <Text style={[styles.effect, { color: theme.textSecondary }]}>
        {reply
          ? REPLY_EFFECT[reply](task?.title ?? 'your task')
          : `Sends this as a new report${where ? ` from ${where}` : ''}. You’ll get an update in Inbox.`}
      </Text>
      <View style={styles.heardActions}>
        <Button variant="tinted" label="Try again" color={theme.textSecondary} onPress={onCancel} style={styles.flex} />
        <Button
          label={reply ? REPLY_LABEL[reply] : 'Send report'}
          sf={reply ? REPLY_SF[reply] : 'paperplane.fill'}
          color={reply === 'need_help' ? theme.danger : theme.tint}
          haptic="success"
          onPress={() => onSend(interpretation)}
          style={styles.flex}
        />
      </View>
    </Animated.View>
  );
}

function History({ items }: { items: Said[] }) {
  const theme = useTheme();
  const now = useNow();
  if (items.length === 0) {
    return <Text style={[styles.empty, { color: theme.textTertiary }]}>Nothing yet this shift.</Text>;
  }
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.history}>
      {items.map((h) => (
        <View key={h.id} style={[styles.historyRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.historyHeard, { color: theme.text }]}>“{h.heard}”</Text>
          <Text style={[styles.historyMeta, { color: theme.textSecondary }]}>{h.result} · {ago(h.at, now)}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20 },
  context: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'center', maxWidth: '100%',
    height: 32, paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth * 2,
  },
  contextText: { fontSize: Type.footnote, flexShrink: 1 },
  stage: { flex: 1, justifyContent: 'center', paddingVertical: 28, minHeight: 260 },
  center: { alignItems: 'center', gap: 10 },
  prompt: { fontSize: Type.title, lineHeight: 24, fontWeight: '500', letterSpacing: -0.2, textAlign: 'center' },
  sentText: { fontSize: Type.body + 1, fontWeight: '500', textAlign: 'center' },
  heard: { gap: 10 },
  heardCard: { padding: 14, gap: 4, borderRadius: Radius.card, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2 },
  heardLabel: { fontSize: Type.caption, fontWeight: '600' },
  // Long rambles scroll inside the card instead of pushing the buttons off-screen.
  heardScroll: { maxHeight: 200, flexGrow: 0 },
  heardText: { fontSize: Type.body, lineHeight: 21 },
  effect: { fontSize: Type.footnote, lineHeight: 18, paddingHorizontal: 4 },
  heardActions: { flexDirection: 'row', gap: 8 },
  typeRow: { borderRadius: Radius.control, paddingHorizontal: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth * 2 },
  input: { fontSize: Type.body, height: 44 },
  status: { textAlign: 'center', fontSize: Type.footnote, fontWeight: '500', marginBottom: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { textAlign: 'center', fontSize: Type.body },
  history: { gap: 6 },
  historyRow: { padding: 12, gap: 2, borderRadius: Radius.control, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2 },
  historyHeard: { fontSize: Type.callout },
  historyMeta: { fontSize: Type.caption },
});

import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { CircleButton } from '@/components/ui/circle-button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useHoldToTalk } from './use-hold-to-talk';
import { PILL_HEIGHT, VoicePill } from './voice-pill';

/** `clips` are the holds it was said in, sent along with it. */
type Held = { before?: string; clips: string[] };
/** `typed` came from the keyboard: it skips the "Heard" check and goes straight out. */
type Said = { text: string; clips: string[]; typed?: boolean };
type Flash = { message: string };
type Phase =
  | { kind: 'idle' }
  /** Recording, then transcribing. `before` is what an earlier hold heard; new words append to it. */
  | ({ kind: 'listening' } & Held)
  | ({ kind: 'hearing' } & Held)
  | ({ kind: 'review' } & Said)
  | ({ kind: 'sending' } & Said)
  | ({ kind: 'sent' } & Flash)
  | ({ kind: 'missed' } & Flash);

const PAD_TOP = 10;

/** Height the dock covers at rest, so sheet content can scroll clear of it. */
export function useDockHeight() {
  return PAD_TOP + PILL_HEIGHT + Math.max(useSafeAreaInsets().bottom, 12) + 8;
}

/**
 * The assistant, pinned to the bottom of the screen: hold the pill to talk, or tap the keyboard to type.
 * Letting go sends the recording to be transcribed, and what was heard comes back in a small tray above
 * the pill to check before it goes. Typed words go straight out: there's nothing to mishear. Sending hands
 * the words to the AI, which triages and acts; what it did comes back as the confirmation.
 */
export function VoiceDock({ placeholder, onSend }: {
  placeholder: string;
  /** Send what was said, with the clips it was said in. A returned string is shown briefly as the confirmation. */
  onSend: (text: string, clips: string[]) => Promise<string | void>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hold = useHoldToTalk();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const flashedAt = useRef(0);

  const listening = phase.kind === 'listening';

  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }],
  }));

  const heard = (text: string, clips: string[] = []) => {
    const t = text.trim();
    setPhase(t ? { kind: 'review', text: t, clips } : { kind: 'idle' });
  };

  /** A line that shows for a moment, then gets out of the way. */
  const flash = (kind: 'sent' | 'missed', message: string) => {
    const at = (flashedAt.current = Date.now());
    setPhase({ kind, message });
    setTimeout(() => setPhase((p) => (p.kind === kind && flashedAt.current === at ? { kind: 'idle' } : p)), 2500);
  };

  const send = async (text: string, clips: string[], typed = false) => {
    setPhase({ kind: 'sending', text, clips, typed });
    try {
      const message = await onSend(text, clips);
      if (!message) return setPhase({ kind: 'idle' });
      flash('sent', message);
    } catch {
      if (!typed) return setPhase({ kind: 'review', text, clips });
      // Back in the box to send again, rather than a "Heard" check of what was typed.
      setTyped(text);
      setTyping(true);
      flash('missed', 'Didn’t send');
    }
  };

  const submitTyped = () => {
    const t = typed.trim();
    setTyped('');
    setTyping(false);
    if (t) send(t, [], true);
  };

  const startHold = () => {
    hold.start();
    setPhase((p) => (p.kind === 'review' ? { kind: 'listening', before: p.text, clips: p.clips } : { kind: 'listening', clips: [] }));
  };

  const endHold = async () => {
    if (phase.kind !== 'listening') return;
    const { before, clips } = phase;
    setPhase({ kind: 'hearing', before, clips });
    const back = () => (before ? heard(before, clips) : setPhase({ kind: 'idle' }));
    try {
      const said = await hold.stop();
      if (said) heard([before, said.text].filter(Boolean).join(' '), said.clip ? [...clips, said.clip] : clips);
      else if (before) back();
      else flash('missed', 'Didn’t catch that');
    } catch (e) {
      console.warn('[voice] transcribe failed', e);
      if (before) back();
      else flash('missed', 'Voice is down. Type instead.');
    }
  };

  const reviewing = phase.kind === 'review' || phase.kind === 'sending';

  return (
    <Animated.View
      style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) + 8, backgroundColor: theme.card }, lift]}>
      {/* Content scrolling under the dock fades out instead of being cut by a hard edge. */}
      <View
        pointerEvents="none"
        style={[styles.fade, { experimental_backgroundImage: `linear-gradient(to bottom, ${theme.card}00, ${theme.card})` }]}
      />

      {phase.kind !== 'idle' && (
        <Animated.View
          key={phase.kind === 'listening' ? 'live' : phase.kind === 'sent' || phase.kind === 'missed' ? phase.kind : 'heard'}
          entering={FadeInDown.duration(200)}
          style={[styles.tray, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {phase.kind === 'sent' || phase.kind === 'missed' ? (
            <View style={styles.sent}>
              {phase.kind === 'sent' ? (
                <Icon sf="checkmark.circle.fill" md="check_circle" size={18} color={theme.success} />
              ) : (
                <Icon sf="exclamationmark.circle.fill" md="error" size={18} color={theme.warning} />
              )}
              <Text style={[styles.sentText, { color: theme.text }]}>{phase.message}</Text>
            </View>
          ) : phase.kind === 'listening' || phase.kind === 'hearing' ? (
            <>
              <Text style={[styles.label, { color: listening ? theme.tint : theme.textTertiary }]}>{listening ? 'Listening' : 'Heard'}</Text>
              <Caption>
                <Text style={styles.text}>
                  {!!phase.before && <Text style={{ color: theme.text }}>{phase.before} </Text>}
                  <Text style={{ color: theme.textTertiary }}>{listening ? (phase.before ? '' : 'Go ahead…') : '…'}</Text>
                </Text>
              </Caption>
            </>
          ) : phase.kind === 'sending' && phase.typed ? (
            <>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Sending</Text>
              <Caption>
                <Text style={[styles.text, { color: theme.text }]}>{phase.text}</Text>
              </Caption>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: theme.textTertiary }]}>Heard</Text>
              <Caption>
                <Text style={[styles.text, { color: theme.text }]} selectable>{phase.text}</Text>
              </Caption>
              <View style={styles.actions}>
                <Button
                  variant="tinted"
                  size="small"
                  label="Try again"
                  color={theme.textSecondary}
                  onPress={() => setPhase({ kind: 'idle' })}
                  style={styles.flex}
                />
                <Button
                  size="small"
                  label="Send"
                  haptic="success"
                  disabled={phase.kind === 'sending'}
                  onPress={() => send(phase.text, phase.clips)}
                  style={styles.flex}
                />
              </View>
            </>
          )}
        </Animated.View>
      )}

      <View style={styles.row}>
        {typing ? (
          <View style={[styles.input, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              autoFocus
              value={typed}
              onChangeText={setTyped}
              placeholder={placeholder}
              placeholderTextColor={theme.textSecondary}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={submitTyped}
              style={[styles.inputText, { color: theme.text }]}
            />
          </View>
        ) : (
          <VoicePill
            listening={listening}
            level={hold.level}
            placeholder={reviewing ? 'Hold to add more' : placeholder}
            disabled={phase.kind === 'sending' || phase.kind === 'hearing'}
            onHoldStart={startHold}
            onHoldEnd={endHold}
          />
        )}
        <CircleButton size={PILL_HEIGHT} label={typing ? 'Talk instead' : 'Type instead'} onPress={() => setTyping((t) => !t)}>
          <Icon sf={typing ? 'mic' : 'keyboard'} md={typing ? 'mic' : 'keyboard'} size={19} color={theme.textSecondary} />
        </CircleButton>
      </View>
    </Animated.View>
  );
}

/** Long rambles scroll inside the tray instead of pushing the buttons off-screen; follows the newest words. */
function Caption({ children }: { children: ReactNode }) {
  const scroll = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={scroll}
      style={styles.caption}
      nestedScrollEnabled
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: PAD_TOP, paddingHorizontal: 16, gap: 10 },
  fade: { position: 'absolute', left: 0, right: 0, top: -20, height: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tray: {
    padding: 14,
    gap: 4,
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    boxShadow: '0 4px 18px rgba(17, 24, 39, 0.06)',
  },
  label: { fontSize: Type.caption, fontWeight: '600' },
  caption: { maxHeight: 120, flexGrow: 0 },
  text: { fontSize: Type.body, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentText: { flex: 1, fontSize: Type.callout, fontWeight: '500' },
  input: { flex: 1, height: PILL_HEIGHT, borderRadius: Radius.pill, paddingHorizontal: 18, justifyContent: 'center' },
  inputText: { fontSize: Type.body, height: PILL_HEIGHT },
});

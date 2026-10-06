import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { CircleButton } from '@/components/ui/circle-button';
import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LiveTranscript, useSimulatedTranscript } from './live-transcript';
import { PILL_HEIGHT, VoicePill } from './voice-pill';

type Phase =
  | { kind: 'idle' }
  /** `before` is what an earlier hold heard; new words append to it. */
  | { kind: 'listening'; script: string; before?: string }
  | { kind: 'review'; text: string }
  | { kind: 'sending'; text: string }
  | { kind: 'sent'; message: string };

const PAD_TOP = 10;

/** Height the dock covers at rest, so sheet content can scroll clear of it. */
export function useDockHeight() {
  return PAD_TOP + PILL_HEIGHT + Math.max(useSafeAreaInsets().bottom, 12) + 8;
}

/**
 * The assistant, pinned to the bottom of the screen: hold the pill to talk, or tap the keyboard to type.
 * What was heard comes back in a small tray above it to check before it goes. Sending hands the words
 * to the AI, which triages and acts; what it did comes back as the confirmation.
 * `script` stands in for STT until audio lands: what a hold "says", given what's been heard so far.
 */
export function VoiceDock({ placeholder, script, onSend }: {
  placeholder: string;
  script: (before?: string) => string;
  /** Send what was said. A returned string is shown briefly as the confirmation. */
  onSend: (text: string) => Promise<string | void>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const sentAt = useRef(0);

  const listening = phase.kind === 'listening';
  const before = listening ? phase.before : undefined;
  const stream = useSimulatedTranscript(listening ? phase.script : null);

  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }],
  }));

  const heard = (text: string) => {
    const t = text.trim();
    setPhase(t ? { kind: 'review', text: t } : { kind: 'idle' });
  };

  const send = async (text: string) => {
    setPhase({ kind: 'sending', text });
    try {
      const message = await onSend(text);
      if (!message) return setPhase({ kind: 'idle' });
      const at = (sentAt.current = Date.now());
      setPhase({ kind: 'sent', message });
      setTimeout(() => setPhase((p) => (p.kind === 'sent' && sentAt.current === at ? { kind: 'idle' } : p)), 2500);
    } catch {
      setPhase({ kind: 'review', text });
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
          key={phase.kind === 'listening' ? 'live' : phase.kind === 'sent' ? 'sent' : 'heard'}
          entering={FadeInDown.duration(200)}
          style={[styles.tray, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {phase.kind === 'sent' ? (
            <View style={styles.sent}>
              <Icon sf="checkmark.circle.fill" md="check_circle" size={18} color={theme.success} />
              <Text style={[styles.sentText, { color: theme.text }]}>{phase.message}</Text>
            </View>
          ) : phase.kind === 'listening' ? (
            <>
              <Text style={[styles.label, { color: theme.tint }]}>Listening</Text>
              <Caption>
                {stream.tokens.length || before ? (
                  <LiveTranscript tokens={stream.tokens} before={before} style={styles.text} />
                ) : (
                  <Text style={[styles.text, { color: theme.textTertiary }]}>Go ahead…</Text>
                )}
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
                  onPress={() => send(phase.text)}
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
              onSubmitEditing={() => {
                heard(typed);
                setTyped('');
                setTyping(false);
              }}
              style={[styles.inputText, { color: theme.text }]}
            />
          </View>
        ) : (
          <VoicePill
            listening={listening}
            placeholder={reviewing ? 'Hold to add more' : placeholder}
            disabled={phase.kind === 'sending'}
            onHoldStart={() => {
              const keep = reviewing ? phase.text : undefined;
              setPhase({ kind: 'listening', script: script(keep), before: keep });
            }}
            onHoldEnd={() => {
              // Whatever was heard by the time they let go is what we read back; nothing new → back to the review.
              const text = [before, stream.text].filter(Boolean).join(' ');
              heard(text);
            }}
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

import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { useHoldToTalk } from '@/components/voice/use-hold-to-talk';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'hearing' }
  /** What a hold heard, waiting for Send. `clips` are the holds it was said in. */
  | { kind: 'review'; text: string; clips: string[] }
  | { kind: 'sending'; text: string; clips: string[]; typed: boolean };

export const BAR = 68;

/**
 * Hi-vis: one bar pinned to the bottom that is always the next step and never moves. Hold it to talk; let go and
 * it says Send, with what was heard above it like a subtitle. The keyboard beside it switches to typing, and typed
 * words go straight out: there's nothing to mishear. `rest` shows above the bar when nothing is being said.
 */
export function HiVisBar({ placeholder, onSend, rest, onHeight }: {
  placeholder: string;
  /** Send what was said, with the clips it was said in. Throws if it didn't go. */
  onSend: (text: string, clips: string[]) => Promise<void>;
  rest?: ReactNode;
  /** Height the bar and whatever sits above it cover, so the map can frame what's left. */
  onHeight?: (h: number) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hold = useHoldToTalk();
  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  /** A word in place of the bar's label for a moment: "Didn't catch that", "Didn't send". */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeAt = useRef(0);
  // The gesture's callbacks can fire before a re-render lands; they read the phase from here, not a stale closure.
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }],
  }));

  const say = (message: string) => {
    const at = (noticeAt.current = Date.now());
    setNotice(message);
    setTimeout(() => setNotice((n) => (noticeAt.current === at ? null : n)), 2500);
  };
  const quiet = () => {
    noticeAt.current = 0;
    setNotice(null);
  };

  const send = async (text: string, clips: string[], fromKeyboard: boolean) => {
    const t = text.trim();
    if (!t) return;
    quiet();
    setPhase({ kind: 'sending', text: t, clips, typed: fromKeyboard });
    try {
      await onSend(t, clips);
      setPhase({ kind: 'idle' });
    } catch {
      if (fromKeyboard) {
        setTyped(t);
        setTyping(true);
        setPhase({ kind: 'idle' });
      } else setPhase({ kind: 'review', text: t, clips });
      say('Didn’t send');
    }
  };

  const sendTyped = () => {
    const t = typed.trim();
    if (!t) return;
    setTyped('');
    setTyping(false);
    send(t, [], true);
  };

  const holdStart = () => {
    if (phaseRef.current.kind !== 'idle') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    quiet();
    hold.start();
    setPhase({ kind: 'listening' });
  };

  const holdEnd = async () => {
    if (phaseRef.current.kind !== 'listening') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase({ kind: 'hearing' });
    try {
      const said = await hold.stop();
      if (said) setPhase({ kind: 'review', text: said.text.trim(), clips: said.clip ? [said.clip] : [] });
      else {
        setPhase({ kind: 'idle' });
        say('Didn’t catch that');
      }
    } catch (e) {
      console.warn('[voice] transcribe failed', e);
      setPhase({ kind: 'idle' });
      say('Voice is down');
    }
  };

  const speaking = typing || phase.kind !== 'idle';

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[styles.stack, { paddingBottom: Math.max(insets.bottom, 12) }, lift]}>
      {speaking ? (
        <Caption
          phase={phase}
          typing={typing}
          typed={typed}
          setTyped={setTyped}
          placeholder={placeholder}
          onSubmit={sendTyped}
        />
      ) : (
        rest
      )}

      <View style={styles.row}>
        <Side
          phase={phase}
          typing={typing}
          onAgain={() => setPhase({ kind: 'idle' })}
          onToggle={() => {
            quiet();
            setTyping((t) => !t);
          }}
        />
        {typing || phase.kind === 'review' || phase.kind === 'sending' ? (
          <SendBar
            label={notice ?? 'Send'}
            busy={phase.kind === 'sending'}
            disabled={phase.kind === 'sending' || (typing && !typed.trim())}
            onPress={() => (typing ? sendTyped() : phase.kind === 'review' && send(phase.text, phase.clips, false))}
          />
        ) : (
          <HoldBar disabled={phase.kind === 'hearing'} onStart={holdStart} onEnd={holdEnd}>
            {phase.kind === 'listening' ? (
              <Level level={hold.level} color={theme.onTint} />
            ) : phase.kind === 'hearing' ? (
              <ActivityIndicator color={theme.onTint} />
            ) : (
              <Text style={[styles.barText, { color: theme.onTint }]} numberOfLines={1}>{notice ?? 'Hold to talk'}</Text>
            )}
          </HoldBar>
        )}
      </View>
    </Animated.View>
  );
}

/** Keyboard at rest, mic while typing, Again once something's heard. Steps aside while a hold is live. */
function Side({ phase, typing, onAgain, onToggle }: {
  phase: Phase;
  typing: boolean;
  onAgain: () => void;
  onToggle: () => void;
}) {
  const theme = useTheme();
  if (!typing && (phase.kind === 'listening' || phase.kind === 'hearing')) return null;
  if (phase.kind === 'sending' && !phase.typed) return null;
  const again = phase.kind === 'review';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={again ? 'Again' : typing ? 'Talk instead' : 'Type instead'}
      disabled={phase.kind === 'sending'}
      onPress={() => {
        Haptics.selectionAsync();
        if (again) onAgain();
        else onToggle();
      }}
      style={({ pressed }) => [
        styles.side,
        { backgroundColor: pressed ? theme.backgroundElement : theme.card, borderColor: theme.border },
      ]}>
      {again ? (
        <Text style={[styles.sideText, { color: theme.text }]}>Again</Text>
      ) : (
        <Icon sf={typing ? 'mic' : 'keyboard'} md={typing ? 'mic' : 'keyboard'} size={22} color={theme.text} />
      )}
    </Pressable>
  );
}

/**
 * Hold anywhere inside to talk. Starts on touch-down and ends on lift wherever the finger went,
 * so a shaky thumb walking through a crowd never cuts the recording off.
 */
function HoldBar({ disabled, onStart, onEnd, children }: {
  disabled: boolean;
  onStart: () => void;
  onEnd: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const gesture = Gesture.LongPress()
    .minDuration(0)
    .maxDistance(100_000)
    .shouldCancelWhenOutside(false)
    .enabled(!disabled)
    .runOnJS(true)
    .onBegin(onStart)
    .onFinalize(onEnd);
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel="Hold to talk"
        accessibilityState={{ disabled }}
        style={[styles.bar, { backgroundColor: theme.tint }]}>
        {children}
      </View>
    </GestureDetector>
  );
}

function SendBar({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send"
      disabled={disabled}
      onPress={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPress();
      }}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: theme.tint, opacity: busy ? 1 : disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.onTint} />
      ) : (
        <Text style={[styles.barText, { color: theme.onTint }]} numberOfLines={1}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Subtitles: what was heard, big, right above the thumb. Becomes the text box when typing. */
function Caption({ phase, typing, typed, setTyped, placeholder, onSubmit }: {
  phase: Phase;
  typing: boolean;
  typed: string;
  setTyped: (t: string) => void;
  placeholder: string;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  if (typing) {
    return (
      <Animated.View entering={FadeIn.duration(150)} style={[styles.caption, { backgroundColor: theme.card, borderColor: theme.tint }]}>
        <TextInput
          autoFocus
          multiline
          value={typed}
          onChangeText={setTyped}
          placeholder={placeholder}
          placeholderTextColor={theme.textTertiary}
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          style={[styles.big, styles.input, { color: theme.text }]}
        />
      </Animated.View>
    );
  }
  const text = phase.kind === 'review' || phase.kind === 'sending' ? phase.text : null;
  return (
    <Animated.View entering={FadeIn.duration(150)} style={[styles.caption, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {phase.kind === 'hearing' ? (
        <ActivityIndicator color={theme.textTertiary} style={styles.spinner} />
      ) : (
        // Long rambles scroll inside instead of pushing the bar off-screen.
        <ScrollView
          ref={scroll}
          style={styles.scroll}
          nestedScrollEnabled
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <Text style={[styles.big, { color: text ? theme.text : theme.textTertiary }]} selectable={!!text}>
            {text ?? 'Listening'}
          </Text>
        </ScrollView>
      )}
    </Animated.View>
  );
}

const LEVEL_SHAPE = [0.35, 0.6, 0.45, 0.85, 0.55, 1, 0.5, 0.75, 0.4, 0.9, 0.5, 0.65, 0.35, 0.7, 0.45, 0.8, 0.4];

/** The microphone level, in the bar's own text colour. */
function Level({ level, color }: { level: number; color: string }) {
  const amp = useSharedValue(0);
  useEffect(() => {
    amp.set(withTiming(level, { duration: 90 }));
  }, [amp, level]);
  return (
    <View style={styles.level}>
      {LEVEL_SHAPE.map((k, i) => <LevelBar key={i} k={k} amp={amp} color={color} />)}
    </View>
  );
}

function LevelBar({ k, amp, color }: { k: number; amp: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({ height: 4 + 30 * k * Math.max(0.12, amp.get()) }));
  return <Animated.View style={[styles.levelBar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  bar: {
    flex: 1,
    height: BAR,
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  barText: { fontSize: Type.hero, fontWeight: '700' },
  side: {
    width: BAR,
    height: BAR,
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideText: { fontSize: Type.callout, fontWeight: '700' },
  caption: {
    borderRadius: Radius.card,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 120,
  },
  scroll: { maxHeight: 160, flexGrow: 0 },
  spinner: { alignSelf: 'flex-start', marginTop: 6 },
  big: { fontSize: Type.hero, lineHeight: 29, fontWeight: '700' },
  input: { minHeight: 84, maxHeight: 160, padding: 0, textAlignVertical: 'top' },
  level: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36 },
  levelBar: { width: 4, borderRadius: 2 },
});

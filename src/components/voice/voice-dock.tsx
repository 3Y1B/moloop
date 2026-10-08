import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeIn, interpolateColor, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { SHEET_RADIUS } from '@/components/ui/bottom-sheet';
import { haptic, PRESSED_OPACITY } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { Shadow, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NOT_CAUGHT, NOT_SENT, useFlashTimer } from './flash';
import { useHoldToTalk } from './use-hold-to-talk';

type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'hearing' }
  /** What a hold heard, waiting for Send. `clips` are the holds it was said in. */
  | { kind: 'review'; text: string; clips: string[] }
  | { kind: 'sending'; text: string; clips: string[]; typed: boolean }
  /** What the AI did with it, for a moment. */
  | { kind: 'sent'; message: string };

/** Every voice control is this tall: the hold button, Send, and the buttons beside them. */
export const BAR = 56;
const INNER_RADIUS = BAR / 2;
/** Room above the controls inside the bar. */
const PAD_TOP = 10;
/** Between `rest` and the bar. */
const GAP_ABOVE = 10;

/** Height the dock covers at rest, so content can scroll clear of it. */
export function useDockHeight() {
  return PAD_TOP + BAR + Math.max(useSafeAreaInsets().bottom, 12);
}

/**
 * The one voice input, a bar across the bottom of the screen: hold to talk, then Send, with what was heard above it
 * like a subtitle. The keyboard beside it switches to typing, and typed words go straight out: there's nothing to
 * mishear. Sending hands the words to the AI; a returned string is what it did, shown for a moment. `rest` shows above
 * the dock when nothing is being said.
 *
 * Over a sheet it is the sheet's own bottom: same surface, no edge. On a bare map (`onMap`), and whenever the keyboard
 * lifts it off the sheet, it's a tray with rounded top corners sitting on whatever is under it.
 */
export function VoiceDock({ placeholder, onSend, onDismiss, rest, onHeight, onMap }: {
  placeholder: string;
  /** Send what was said, with the clips it was said in. Throws if it didn't go; a returned string is the confirmation. */
  onSend: (text: string, clips: string[]) => Promise<string | void>;
  /** Shows a × that closes the dock. */
  onDismiss?: () => void;
  rest?: ReactNode;
  /** Height the dock and whatever sits above it cover, so a map can frame what's left. */
  onHeight?: (h: number) => void;
  /** Nothing under it but the map: always the tray. */
  onMap?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hold = useHoldToTalk();
  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  /** A word in place of the button's label for a moment: "Didn't catch that", "Didn't send". */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useFlashTimer();
  const sentTimer = useFlashTimer();
  // The gesture's callbacks can fire before a re-render lands; they read the phase from here, not a stale closure.
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // Rides the keyboard (less the home-indicator inset it already pads for), rounding into a tray as it leaves the sheet.
  const keyboard = useAnimatedKeyboard();
  const bottomPad = Math.max(insets.bottom, 12);
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.get() - insets.bottom) }],
  }));
  const tray = useAnimatedStyle(() => {
    const k = onMap ? 1 : Math.min(1, keyboard.height.get() / 80);
    return {
      borderTopLeftRadius: SHEET_RADIUS * k,
      borderTopRightRadius: SHEET_RADIUS * k,
      borderColor: interpolateColor(k, [0, 1], ['transparent', theme.border]),
    };
  });

  const say = (message: string) => {
    setNotice(message);
    noticeTimer.start(() => setNotice(null));
  };
  const quiet = () => {
    noticeTimer.cancel();
    setNotice(null);
  };

  const send = async (text: string, clips: string[], fromKeyboard: boolean) => {
    const t = text.trim();
    if (!t) return;
    quiet();
    setPhase({ kind: 'sending', text: t, clips, typed: fromKeyboard });
    try {
      const message = await onSend(t, clips);
      if (!message) return setPhase({ kind: 'idle' });
      setPhase({ kind: 'sent', message });
      sentTimer.start(() => phaseRef.current.kind === 'sent' && setPhase({ kind: 'idle' }));
    } catch {
      if (fromKeyboard) {
        setTyped(t);
        setTyping(true);
        setPhase({ kind: 'idle' });
      } else setPhase({ kind: 'review', text: t, clips });
      say(NOT_SENT);
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
    const now = phaseRef.current.kind;
    if (now !== 'idle' && now !== 'sent') return;
    haptic('medium');
    quiet();
    sentTimer.cancel();
    hold.start();
    setPhase({ kind: 'listening' });
  };

  const holdEnd = async () => {
    if (phaseRef.current.kind !== 'listening') return;
    haptic('light');
    setPhase({ kind: 'hearing' });
    try {
      const said = await hold.stop();
      if (said) setPhase({ kind: 'review', text: said.text.trim(), clips: said.clip ? [said.clip] : [] });
      else {
        setPhase({ kind: 'idle' });
        say(NOT_CAUGHT);
      }
    } catch (e) {
      console.warn('[voice] transcribe failed', e);
      setPhase({ kind: 'idle' });
      say('Voice is down');
    }
  };

  const speaking = typing || phase.kind !== 'idle';
  const busy = phase.kind === 'listening' || phase.kind === 'hearing' || phase.kind === 'sending';

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[styles.stack, lift]}>
      {!speaking && rest && <View style={styles.rest}>{rest}</View>}

      <Animated.View
        style={[styles.dock, { backgroundColor: theme.card, paddingBottom: bottomPad }, onMap && Shadow.sheet, tray]}>
        {speaking && (
          <Caption
            phase={phase}
            typing={typing}
            typed={typed}
            setTyped={setTyped}
            placeholder={placeholder}
            onSubmit={sendTyped}
          />
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
            <SendButton
              label={notice ?? 'Send'}
              busy={phase.kind === 'sending'}
              disabled={phase.kind === 'sending' || (typing && !typed.trim())}
              onPress={() => (typing ? sendTyped() : phase.kind === 'review' && send(phase.text, phase.clips, false))}
            />
          ) : (
            <HoldButton
              label={notice ?? 'Hold to talk'}
              icon={!notice}
              live={phase.kind === 'listening'}
              busy={phase.kind === 'hearing'}
              level={hold.level}
              onStart={holdStart}
              onEnd={holdEnd}
            />
          )}
          {onDismiss && !busy && (
            <SideButton
              label="Dismiss"
              onPress={() => {
                setTyping(false);
                onDismiss();
              }}>
              <Icon sf="xmark" md="close" size={18} color={theme.textSecondary} weight="medium" />
            </SideButton>
          )}
        </View>
      </Animated.View>
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
  if (phase.kind === 'review') {
    return (
      <SideButton label="Again" filled onPress={onAgain}>
        <Text style={styles.sideLabel} color={theme.text}>Again</Text>
      </SideButton>
    );
  }
  return (
    <SideButton label={typing ? 'Talk instead' : 'Type instead'} disabled={phase.kind === 'sending'} onPress={onToggle}>
      <Icon sf={typing ? 'mic' : 'keyboard'} md={typing ? 'mic' : 'keyboard'} size={22} color={theme.textSecondary} weight="medium" />
    </SideButton>
  );
}

/** A quiet round control beside the main button; `filled` for a worded one ("Again"). */
function SideButton({ label, filled, disabled, onPress, children }: {
  label: string;
  filled?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        styles.side,
        filled && styles.sideWide,
        { backgroundColor: pressed || filled ? theme.backgroundElement : 'transparent' },
      ]}>
      {children}
    </Pressable>
  );
}

const RETAIN = { top: 2000, bottom: 2000, left: 2000, right: 2000 };

/**
 * Hold anywhere inside to talk: starts on touch-down, ends on lift. `quiet` when something else on the screen is the
 * primary action.
 */
export function HoldButton({ label, icon = true, live, busy, level, quiet, onStart, onEnd }: {
  label: string;
  /** The mic before the label. */
  icon?: boolean;
  /** Recording: the level meter takes over. */
  live: boolean;
  /** Transcribing: a spinner, and holds are off. */
  busy: boolean;
  level: number;
  quiet?: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  const theme = useTheme();
  const fg = quiet ? theme.text : theme.onTint;
  const press = useSharedValue(0);
  useEffect(() => {
    press.set(withTiming(live ? 1 : 0, { duration: 140 }));
  }, [press, live]);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.025 * press.get() }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      // A shaky thumb walking through a crowd can drift anywhere on screen without cutting the recording off.
      pressRetentionOffset={RETAIN}
      onPressIn={onStart}
      onPressOut={onEnd}
      style={styles.flex}>
      <Animated.View style={[styles.bar, { backgroundColor: quiet ? theme.backgroundElement : theme.tint }, sink]}>
        {/* The touch stays on the bar: the icon swapping for the meter under the finger mustn't cancel the hold. */}
        <View pointerEvents="none" style={styles.barContent}>
          {live ? (
            <Level level={level} color={quiet ? theme.tint : fg} />
          ) : busy ? (
            <ActivityIndicator color={fg} />
          ) : (
            <>
              {icon && <Icon sf="mic.fill" md="mic" size={20} color={fg} weight="semibold" />}
              <Text style={styles.label} color={fg} numberOfLines={1}>{label}</Text>
            </>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** Filled when there's something to send; a quiet well until then, never a washed-out blue over the map. */
function SendButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const idle = disabled && !busy;
  const fg = idle ? theme.textTertiary : theme.onTint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptic('success');
        onPress();
      }}
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: idle ? theme.backgroundElement : theme.tint, opacity: pressed ? PRESSED_OPACITY : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.onTint} />
      ) : (
        <>
          <Text style={styles.label} color={fg} numberOfLines={1}>{label}</Text>
          {label === 'Send' && <Icon sf="arrow.up" md="arrow_upward" size={18} color={fg} weight="bold" />}
        </>
      )}
    </Pressable>
  );
}

/** Subtitles: what was heard, right above the thumb. Becomes the text box when typing, and the confirmation once sent. */
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
      <Animated.View entering={FadeIn.duration(150)} style={styles.caption}>
        <TextInput
          autoFocus
          multiline
          value={typed}
          onChangeText={setTyped}
          placeholder={placeholder}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.tint}
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          style={[styles.words, styles.input, { color: theme.text }]}
        />
      </Animated.View>
    );
  }
  if (phase.kind === 'sent') {
    return (
      <Animated.View entering={FadeIn.duration(150)} style={[styles.caption, styles.status]}>
        <Icon sf="checkmark.circle.fill" md="check_circle" size={20} color={theme.success} />
        <Text style={[styles.words, styles.flex]} color={theme.text}>{phase.message}</Text>
      </Animated.View>
    );
  }
  const text = phase.kind === 'review' || phase.kind === 'sending' ? phase.text : null;
  return (
    <Animated.View entering={FadeIn.duration(150)} style={styles.caption}>
      {text ? (
        // Long rambles scroll inside instead of pushing the buttons off-screen.
        <ScrollView
          ref={scroll}
          style={styles.scroll}
          nestedScrollEnabled
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <Text style={styles.words} color={theme.text} selectable>{text}</Text>
        </ScrollView>
      ) : (
        <View style={styles.status}>
          {phase.kind === 'hearing' ? (
            <ActivityIndicator size="small" color={theme.textTertiary} />
          ) : (
            <LiveDot color={theme.tint} />
          )}
          <Text style={styles.words} color={theme.textTertiary}>Listening</Text>
        </View>
      )}
    </Animated.View>
  );
}

/** A slow pulse beside "Listening" while the mic is open. */
function LiveDot({ color }: { color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * t.get(), transform: [{ scale: 0.8 + 0.2 * t.get() }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const LEVEL_SHAPE = [0.35, 0.6, 0.45, 0.85, 0.55, 1, 0.5, 0.75, 0.4, 0.9, 0.5, 0.65, 0.35, 0.7, 0.45, 0.8, 0.4, 0.6, 0.35];

/** The microphone level, in the button's own text colour. */
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
  const style = useAnimatedStyle(() => ({ height: 4 + 24 * k * Math.max(0.12, amp.get()) }));
  return <Animated.View style={[styles.levelBar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  rest: { paddingHorizontal: 12, marginBottom: GAP_ABOVE },
  dock: {
    paddingHorizontal: 12,
    paddingTop: PAD_TOP,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bar: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: BAR,
    borderRadius: INNER_RADIUS,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  barContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: {
    width: BAR,
    height: BAR,
    borderRadius: INNER_RADIUS,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideWide: { width: 'auto', paddingHorizontal: 20 },
  sideLabel: { fontSize: Type.body, fontWeight: '600' },
  // Hi-vis: heavier than the body ramp, for reading at arm's length.
  label: { fontSize: Type.title, fontWeight: '700', letterSpacing: -0.2 },
  caption: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, minHeight: 64 },
  scroll: { maxHeight: 160, flexGrow: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  words: { fontSize: Type.headline, lineHeight: 23, fontWeight: '500', letterSpacing: -0.2 },
  input: { minHeight: 46, maxHeight: 160, padding: 0, textAlignVertical: 'top', outlineColor: 'transparent' },
  level: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30 },
  levelBar: { width: 3, borderRadius: 1.5 },
});

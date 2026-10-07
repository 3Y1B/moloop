import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoopMark } from '@/components/brand/loop-mark';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Brand, Fonts, Radius, Type } from '@/constants/theme';
import { useSnapshot } from '@/data/hooks';
import { sendCode, signInAsGuest, verifyCode } from '@/data/supabase/client';
import { useTheme } from '@/hooks/use-theme';

type Step = 'choose' | 'email' | 'code';

const CODE_LENGTH = 6;
const EASE = LinearTransition.duration(380);

/** Supabase auth errors → one short line. */
function problem(e: unknown): string {
  const message = e instanceof Error ? e.message.toLowerCase() : '';
  if (message.includes('signup') || message.includes('not found')) return 'No crew account for that email';
  if (message.includes('expired') || message.includes('invalid')) return 'Wrong or expired code';
  if (message.includes('rate') || message.includes('security purposes')) return 'Too many tries. Wait a minute';
  return 'Couldn’t sign in';
}

/**
 * Sign in on the live backend: crew by email code, festival-goers anonymously.
 * Once the session is in and the world has loaded, the role layouts take over.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const s = useSnapshot();
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'guest' | 'crew' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (s.meId) return <Redirect href="/" />;
  // Signed in, world still loading.
  if (s.status === 'loading' || s.status === 'error') {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: Brand.blue }]}>
        <StatusBar style="light" />
        <LoopMark width={112} alive />
      </View>
    );
  }

  const run = async (who: 'guest' | 'crew', fn: () => Promise<void>, next?: Step) => {
    setBusy(who);
    setError(null);
    try {
      await fn();
      if (next) setStep(next);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  };

  const back = () => {
    setError(null);
    setCode('');
    setStep(step === 'code' ? 'email' : 'choose');
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const validCode = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code.trim());
  const send = () => validEmail && !busy && run('crew', () => sendCode(email), 'code');
  const verify = () => validCode && !busy && run('crew', () => verifyCode(email, code));

  const open = step === 'choose';
  const heroHeight = open ? Math.max(insets.top + 300, height * 0.56) : insets.top + 168;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />

      <Animated.View layout={EASE} style={[styles.hero, { height: heroHeight, paddingTop: insets.top }]}>
        {/* A big faint loop behind the mark, so the blue isn't a flat slab. */}
        <View pointerEvents="none" style={styles.backdrop}>
          <LoopMark width={640} color="#FFFFFF" />
        </View>

        {!open && (
          <Animated.View entering={FadeIn.duration(200)} style={[styles.backWrap, { top: insets.top + 8 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={10}
              disabled={!!busy}
              onPress={back}
              style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon sf="chevron.left" md="arrow_back" size={17} color="#FFFFFF" weight="semibold" />
            </Pressable>
          </Animated.View>
        )}

        <Brandmark open={open} />
      </Animated.View>

      <Animated.View layout={EASE} style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
        {step === 'choose' && (
          <Animated.View key="choose" entering={FadeInDown.duration(320)} style={styles.stack}>
            <Choice
              sf="person.badge.key.fill"
              md="badge"
              title="Crew"
              disabled={!!busy}
              onPress={() => {
                setError(null);
                setStep('email');
              }}
            />
            <Choice
              sf="ticket.fill"
              md="confirmation_number"
              title="I’m at the festival"
              busy={busy === 'guest'}
              disabled={!!busy}
              onPress={() => run('guest', signInAsGuest)}
            />
          </Animated.View>
        )}

        {step === 'email' && (
          <Animated.View key="email" entering={FadeInDown.duration(320)} style={styles.stack}>
            <Text style={[styles.heading, { color: theme.text }]}>Crew sign-in</Text>
            <View style={[styles.field, { backgroundColor: theme.backgroundElement }]}>
              <Icon sf="envelope.fill" md="mail" size={17} color={theme.textTertiary} />
              <TextInput
                autoFocus
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={send}
                style={[styles.fieldInput, { color: theme.text }]}
              />
            </View>
            <Button label={busy ? 'Sending…' : 'Send code'} size="large" color={Brand.blue} disabled={!validEmail || !!busy} onPress={send} />
          </Animated.View>
        )}

        {step === 'code' && (
          <Animated.View key="code" entering={FadeInDown.duration(320)} style={styles.stack}>
            <View style={styles.headingBlock}>
              <Text style={[styles.heading, { color: theme.text }]}>Enter code</Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
                {email.trim()}
              </Text>
            </View>
            <CodeCells value={code} onChange={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))} onDone={verify} />
            <Button label={busy ? 'Signing in…' : 'Sign in'} size="large" color={Brand.blue} disabled={!validCode || !!busy} onPress={verify} />
            <Button label="Resend code" variant="plain" size="small" color={Brand.blue} disabled={!!busy} onPress={() => run('crew', () => sendCode(email))} />
          </Animated.View>
        )}

        <Text style={[styles.error, { color: theme.danger }]}>{error ?? ' '}</Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

/** Loop + wordmark. Shrinks out of the way once there's a form to fill. */
function Brandmark({ open }: { open: boolean }) {
  const scale = useSharedValue(open ? 1 : 0.62);
  useEffect(() => {
    scale.value = withTiming(open ? 1 : 0.62, { duration: 380 });
  }, [open, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.brand, style]}>
      <LoopMark width={132} alive />
      <Text style={styles.wordmark}>moloop</Text>
      {open && (
        <Animated.Text entering={FadeIn.delay(500).duration(400)} style={styles.tagline}>
          Everyone in the loop
        </Animated.Text>
      )}
    </Animated.View>
  );
}

function Choice({ sf, md, title, onPress, busy, disabled }: {
  sf: string;
  md: string;
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: theme.card, borderColor: theme.border, opacity: disabled && !busy ? 0.5 : 1 },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.choiceIcon, { backgroundColor: `${Brand.blue}14` }]}>
        <Icon sf={sf} md={md} size={20} color={Brand.blue} weight="semibold" />
      </View>
      <Text style={[styles.choiceTitle, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      {busy ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <Icon sf="chevron.right" md="chevron_right" size={14} color={theme.textTertiary} weight="semibold" />
      )}
    </Pressable>
  );
}

/** Six boxes over one invisible input, so paste and SMS/email autofill still work. */
function CodeCells({ value, onChange, onDone }: { value: string; onChange: (t: string) => void; onDone: () => void }) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(true);

  return (
    <Pressable onPress={() => input.current?.focus()} style={styles.cells} accessibilityLabel="Code">
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const digit = value[i];
        const active = focused && i === Math.min(value.length, CODE_LENGTH - 1);
        return (
          <Animated.View
            key={i}
            layout={LinearTransition.duration(150)}
            style={[
              styles.cell,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: active ? Brand.blue : digit ? theme.border : 'transparent',
              },
            ]}>
            <Text style={[styles.cellText, { color: theme.text }]}>{digit ?? ''}</Text>
          </Animated.View>
        );
      })}
      <TextInput
        ref={input}
        autoFocus
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        returnKeyType="done"
        maxLength={CODE_LENGTH}
        onSubmitEditing={onDone}
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  hero: {
    backgroundColor: Brand.blue,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { position: 'absolute', left: -150, bottom: -120, opacity: 0.07 },
  backWrap: { position: 'absolute', left: 16, zIndex: 1 },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { alignItems: 'center', gap: 14 },
  wordmark: {
    fontFamily: Fonts?.rounded,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1.2,
    color: '#FFFFFF',
  },
  tagline: { fontSize: Type.body, fontWeight: '500', color: Brand.mist, marginTop: -6 },

  body: { flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28, gap: 14 },
  stack: { gap: 12 },
  headingBlock: { gap: 4, marginBottom: 4 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  sub: { fontSize: Type.callout },

  choice: {
    height: 68,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 18,
    gap: 14,
  },
  choiceIcon: { width: 44, height: 44, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  choiceTitle: { flex: 1, fontSize: Type.body + 2, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.85 },

  field: {
    height: 54,
    borderRadius: Radius.control + 2,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  fieldInput: { flex: 1, height: '100%', fontSize: Type.body + 2 },

  cells: { flexDirection: 'row', gap: 8 },
  cell: {
    flex: 1,
    height: 58,
    borderRadius: Radius.control,
    borderCurve: 'continuous',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.011, color: 'transparent' },

  error: { fontSize: Type.callout, minHeight: 20, textAlign: 'center' },
});

import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
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
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoopMark } from '@/components/brand/loop-mark';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Brand, Fonts, Radius, Type } from '@/constants/theme';
import { useSnapshot } from '@/data/hooks';
import { signInAsGuest, signInWithEmail } from '@/data/supabase/client';
import { useTheme } from '@/hooks/use-theme';

type Step = 'choose' | 'email';

/** One calm curve for the whole hero: no overshoot, no stretch. */
const EASE = { duration: 420, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };

/** Sign-in errors → one short line. */
function problem(e: unknown): string {
  const message = e instanceof Error ? e.message.toLowerCase() : '';
  if (message.includes('not found')) return 'No crew account for that email';
  if (message.includes('rate') || message.includes('security purposes')) return 'Too many tries. Wait a minute';
  return 'Couldn’t sign in';
}

/**
 * Sign in on the live backend: crew by email, festival-goers anonymously.
 * Once the session is in and the world has loaded, the role layouts take over.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const s = useSnapshot();
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'guest' | 'crew' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1 = open (choose), 0 = collapsed (form). Drives height, mark size and tagline together.
  const open = step === 'choose';
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, EASE);
  }, [open, progress]);
  const tall = Math.max(insets.top + 300, height * 0.56);
  const short = insets.top + 168;
  const heroStyle = useAnimatedStyle(() => ({ height: interpolate(progress.value, [0, 1], [short, tall]) }));

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

  const run = async (who: 'guest' | 'crew', fn: () => Promise<void>) => {
    setBusy(who);
    setError(null);
    try {
      await fn();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  };

  const back = () => {
    setError(null);
    setStep('choose');
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const submit = () => validEmail && !busy && run('crew', () => signInWithEmail(email));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar style="light" />

      <Animated.View style={[styles.hero, { paddingTop: insets.top }, heroStyle]}>
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

        <Brandmark progress={progress} />
      </Animated.View>

      <View style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
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
                returnKeyType="go"
                onSubmitEditing={submit}
                style={[styles.fieldInput, { color: theme.text }]}
              />
            </View>
            <Button label={busy ? 'Signing in…' : 'Sign in'} size="large" color={Brand.blue} disabled={!validEmail || !!busy} onPress={submit} />
          </Animated.View>
        )}

        <Text style={[styles.error, { color: theme.danger }]}>{error ?? ' '}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Loop + wordmark. Shrinks out of the way once there's a form to fill. */
function Brandmark({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(progress.value, [0, 1], [0.62, 1]) }] }));
  // Stays mounted so the stack never jumps; it just fades with the hero.
  const tagline = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0.6, 1], [0, 1], 'clamp') }));

  return (
    <Animated.View style={[styles.brand, style]}>
      <LoopMark width={132} alive />
      <Text style={styles.wordmark}>moloop</Text>
      <Animated.View entering={FadeIn.delay(500).duration(400)}>
        <Animated.Text style={[styles.tagline, tagline]}>Everyone in the loop</Animated.Text>
      </Animated.View>
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
  // Pinned to the top so collapsing just crops it instead of dragging it around.
  backdrop: { position: 'absolute', left: -150, top: 150, opacity: 0.045 },
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
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },

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
  fieldInput: { flex: 1, height: '100%', fontSize: Type.body + 2, outlineWidth: 0, outlineColor: 'transparent' },

  error: { fontSize: Type.callout, minHeight: 20, textAlign: 'center' },
});

import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { haptic } from '@/components/ui/pressable';
import { Text, textStyle } from '@/components/ui/text';
import { Spacing, Type } from '@/constants/theme';
import { useSnapshot } from '@/data/hooks';
import { signInAsGuest, signInWithEmail } from '@/data/supabase/client';
import { useTheme } from '@/hooks/use-theme';

type Step = 'choose' | 'email';

/** One calm curve for the whole screen: no overshoot. Reanimated skips it under reduced motion. */
const EASE = { duration: 380, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
const layout = LinearTransition.duration(EASE.duration).easing(EASE.easing);

/** Wordmark letter size, and how far it shrinks once there's a form to fill. */
const SIZE = 84;
const SMALL = 0.42;

/** Sign-in errors → one short line. */
function problem(e: unknown): string {
  const message = e instanceof Error ? e.message.toLowerCase() : '';
  if (message.includes('not found')) return 'No crew account for that email';
  if (message.includes('rate') || message.includes('security purposes')) return 'Too many tries. Wait a minute';
  return 'Couldn’t sign in';
}

/**
 * Sign in on the live backend: crew by email, festival-goers anonymously.
 * The wordmark is the screen; its loop is the only progress indicator, running while signing in and while the
 * world loads. Once the session is in and the world has loaded, the role layouts take over.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSnapshot();
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'guest' | 'crew' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed in, world still loading: same screen, wordmark back to full size, loop running, no actions.
  const loading = s.status === 'loading' || s.status === 'error';
  const form = step === 'email' && !loading;

  const scale = useSharedValue(form ? SMALL : 1);
  useEffect(() => {
    scale.value = withTiming(form ? SMALL : 1, EASE);
  }, [form, scale]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (s.meId) return <Redirect href="/" />;

  const run = async (who: 'guest' | 'crew', fn: () => Promise<void>) => {
    setBusy(who);
    setError(null);
    try {
      await fn();
    } catch (e) {
      haptic('error');
      setError(problem(e));
    } finally {
      setBusy(null);
    }
  };

  const crew = () => {
    setError(null);
    setStep('email');
  };
  const back = () => {
    setError(null);
    setStep('choose');
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const submit = () => validEmail && !busy && run('crew', () => signInWithEmail(email));
  const guest = () => !busy && run('guest', signInAsGuest);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />

      <View style={[styles.column, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}>
        <Animated.View layout={layout} style={{ flex: form ? 0 : 1 }} />

        <Animated.View layout={layout} style={{ height: SIZE * (form ? SMALL : 1) * 1.2 }}>
          <Animated.View style={[styles.mark, markStyle]}>
            <Wordmark size={SIZE} spin={!!busy || loading} draw />
          </Animated.View>
        </Animated.View>

        {!form && !loading && (
          <Animated.Text
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(120)}
            style={[styles.tagline, { color: theme.textSecondary }]}>
            Everyone in the loop
          </Animated.Text>
        )}

        {form && (
          <Animated.View entering={FadeIn.delay(120).duration(240)} exiting={FadeOut.duration(120)} style={styles.form}>
            <TextInput
              autoFocus
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              placeholder="Email"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="go"
              editable={!busy}
              onSubmitEditing={submit}
              selectionColor={theme.tint}
              style={[styles.input, { color: theme.text, borderBottomColor: error ? theme.danger : theme.border }]}
            />
          </Animated.View>
        )}

        <Animated.View layout={layout} style={{ flex: form ? 1 : 1.3 }} />

        {!loading && (
          <Animated.View entering={FadeIn.duration(240)} exiting={FadeOut.duration(160)} style={styles.footer}>
            <Text variant="callout" tone="danger" style={styles.error}>{error ?? ' '}</Text>
            <View style={styles.row}>
              <Button
                label={form ? 'Back' : 'Crew'}
                variant="plain"
                size="large"
                haptic={form ? 'none' : 'light'}
                disabled={!!busy}
                onPress={form ? back : crew}
                style={styles.quiet}
              />
              <Button
                label={form ? (busy ? 'Signing in…' : 'Sign in') : 'I’m at the festival'}
                size="large"
                disabled={!!busy || (form && !validEmail)}
                onPress={form ? submit : guest}
                style={styles.primary}
              />
            </View>
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: Spacing.four },

  // Shrinks toward its bottom-left corner so it settles where the heading of the form would be. Absolute, so it
  // always lays out at full size: in the short wrap of the form step it would be squeezed, and iOS clips the letters.
  mark: { position: 'absolute', left: 0, bottom: 0, transformOrigin: 'left bottom' },
  tagline: { ...textStyle('title'), fontWeight: '500', marginTop: Spacing.two },

  form: { marginTop: Spacing.five },
  input: {
    height: 56,
    fontSize: Type.hero,
    fontWeight: '500',
    borderBottomWidth: 1.5,
    outlineWidth: 0,
    outlineColor: 'transparent',
  },

  footer: { gap: Spacing.three - Spacing.one },
  error: { fontWeight: '500', minHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  // Text flush with the gutter, like the wordmark above it.
  quiet: { paddingLeft: 0, paddingRight: Spacing.two },
  primary: { flex: 1 },
});

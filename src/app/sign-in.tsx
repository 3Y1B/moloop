import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Radius, Type } from '@/constants/theme';
import { useSnapshot } from '@/data/hooks';
import { sendCode, signInAsGuest, verifyCode } from '@/data/supabase/client';
import { useTheme } from '@/hooks/use-theme';

type Step = 'choose' | 'email' | 'code';

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
  const s = useSnapshot();
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (s.meId) return <Redirect href="/" />;
  // Signed in, world still loading.
  if (s.status === 'loading' || s.status === 'error') {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  const run = async (fn: () => Promise<void>, next?: Step) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (next) setStep(next);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setError(null);
    setCode('');
    setStep(step === 'code' ? 'email' : 'choose');
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const validCode = /^\d{6}$/.test(code.trim());
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.top}>
        {step !== 'choose' && (
          <Pressable accessibilityRole="button" hitSlop={12} onPress={back} disabled={busy}>
            <Text style={[styles.back, { color: theme.tint }]}>Back</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>Moloop</Text>

        {step === 'choose' && (
          <View style={styles.stack}>
            <Button label="Crew" size="large" onPress={() => setStep('email')} />
            <Button label="I’m at the festival" size="large" variant="tinted" disabled={busy} onPress={() => run(signInAsGuest)} />
          </View>
        )}

        {step === 'email' && (
          <View style={styles.stack}>
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
              onSubmitEditing={() => validEmail && run(() => sendCode(email), 'code')}
              style={inputStyle}
            />
            <Button label="Send code" size="large" disabled={!validEmail || busy} onPress={() => run(() => sendCode(email), 'code')} />
          </View>
        )}

        {step === 'code' && (
          <View style={styles.stack}>
            <Text style={[styles.sub, { color: theme.textSecondary }]}>{email.trim()}</Text>
            <TextInput
              autoFocus
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              placeholderTextColor={theme.textTertiary}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="done"
              onSubmitEditing={() => validCode && run(() => verifyCode(email, code))}
              style={[inputStyle, styles.code]}
            />
            <Button label="Sign in" size="large" disabled={!validCode || busy} onPress={() => run(() => verifyCode(email, code))} />
            <Button label="Resend code" variant="plain" size="small" disabled={busy} onPress={() => run(() => sendCode(email))} />
          </View>
        )}

        <Text style={[styles.error, { color: theme.danger }]}>{error ?? ' '}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { height: 24, justifyContent: 'center' },
  back: { fontSize: Type.body, fontWeight: '500' },
  body: { flex: 1, justifyContent: 'center', gap: 24, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  stack: { gap: 12 },
  sub: { fontSize: Type.callout },
  input: { height: 48, borderRadius: Radius.control, paddingHorizontal: 14, fontSize: Type.body + 1 },
  code: { fontSize: Type.title, letterSpacing: 6, fontVariant: ['tabular-nums'] },
  error: { fontSize: Type.callout, minHeight: 20 },
});

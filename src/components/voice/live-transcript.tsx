import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import Animated, { withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** One streamed word. Unstable words are the recogniser's current guess and may still change. */
export type Token = { text: string; stable: boolean };

/** How many trailing words a streaming recogniser typically keeps revising. */
const UNSTABLE_TAIL = 3;

/** Each word rises in and fades up as it arrives, like captions catching up with speech. */
function pop() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 6 }] },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      transform: [{ translateY: withTiming(0, { duration: 220 }) }],
    },
  };
}

/**
 * Live caption: settled words in ink, the still-changing tail in grey.
 * `before` is what was already heard on an earlier hold; it sits still while new words pop in after it.
 */
export function LiveTranscript({ tokens, before, style }: { tokens: Token[]; before?: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  const kept = (before ?? '').split(/\s+/).filter(Boolean);
  return (
    <Animated.View style={styles.row}>
      {kept.map((w, i) => (
        <Text key={`b${i}`} style={[style, { color: theme.text }]}>{w}</Text>
      ))}
      {tokens.map((t, i) => (
        <Animated.Text
          key={i}
          entering={pop}
          style={[style, { color: t.stable ? theme.text : theme.textTertiary }]}>
          {t.text}
        </Animated.Text>
      ))}
    </Animated.View>
  );
}

/**
 * Stand-in for streaming STT (on-device SpeechAnalyzer or a streaming API) until audio lands.
 * Script words like `{salted|sorted}` arrive as the first guess and settle to the second,
 * the way real partial results get corrected a beat later.
 */
export function useSimulatedTranscript(script: string | null) {
  const words = useMemo(() => (script ?? '').split(/\s+/).filter(Boolean).map((w) => {
    const m = /^\{([^|]+)\|([^}]+)\}(.*)$/.exec(w);
    return m ? { guess: m[1] + m[3], final: m[2] + m[3] } : { guess: w, final: w };
  }), [script]);
  // Progress is tied to the words it was made for, so a new hold starts from zero without a reset render.
  const [progress, setProgress] = useState({ words, count: 0 });
  const count = progress.words === words ? progress.count : 0;

  useEffect(() => {
    if (!words.length) return;
    // Partials arrive in uneven bursts of 1–3 words, with a longer gap after a pause in speech.
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const next = () => {
      const prev = words[n - 1]?.final ?? '';
      timer = setTimeout(() => {
        n = Math.min(words.length, n + 1 + Math.floor(Math.random() * 3));
        setProgress({ words, count: n });
        if (n < words.length) next();
      }, (/[,.]$/.test(prev) ? 450 : 200) + Math.random() * 220);
    };
    next();
    return () => clearTimeout(timer);
  }, [words]);

  const heard = words.slice(0, count);
  const tokens: Token[] = heard.map((w, i) => {
    const stable = i < count - UNSTABLE_TAIL;
    return { text: stable ? w.final : w.guess, stable };
  });
  /** What we'd hand to interpretation if the volunteer let go right now. */
  const text = heard.map((w) => w.final).join(' ');
  return { tokens, text };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 5 },
});

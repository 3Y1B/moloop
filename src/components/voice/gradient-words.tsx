import { Text, type StyleProp, type TextStyle } from 'react-native';

import { VoiceGradient } from '@/constants/theme';

/** Interpolate a hex colour along a list of stops, t ∈ [0, 1]. */
export function mix(stops: readonly string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = parseInt(stops[i].slice(1), 16), b = parseInt(stops[i + 1].slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Text washed word-by-word with the voice gradient, like a live transcript.
 * `lead` limits the gradient to the first N words; the rest keeps the base colour.
 */
export function GradientWords({ text, lead, style }: { text: string; lead?: number; style?: StyleProp<TextStyle> }) {
  const words = text.split(' ');
  const n = Math.min(lead ?? words.length, words.length);
  return (
    <Text style={style}>
      {words.map((w, i) => (
        <Text key={i} style={i < n ? { color: mix(VoiceGradient, n > 1 ? i / (n - 1) : 0) } : undefined}>
          {i ? ' ' : ''}{w}
        </Text>
      ))}
    </Text>
  );
}

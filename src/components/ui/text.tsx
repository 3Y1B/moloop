import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextVariant =
  | 'hero' | 'title' | 'section' | 'rowTitle' | 'body' | 'callout' | 'footnote' | 'meta' | 'caption' | 'label';
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'tint' | 'danger' | 'warning' | 'success';

/** The one type ramp. Snap new text to one of these rather than a raw fontSize. */
const VARIANTS = StyleSheet.create({
  /** Page title: Inbox, a Mo tab. */
  hero: { fontSize: Type.hero, fontWeight: '600', letterSpacing: -0.4 },
  /** Sheet or card title: a task's title, "All clear". */
  title: { fontSize: Type.title, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  /** Section header above a card or list. */
  section: { fontSize: Type.headline, fontWeight: '600', letterSpacing: -0.2 },
  /** The main line of a list row. */
  rowTitle: { fontSize: Type.body, fontWeight: '500' },
  body: { fontSize: Type.body, lineHeight: 21 },
  callout: { fontSize: Type.callout },
  footnote: { fontSize: Type.footnote },
  /** Times and who: "7:23am · Ana". */
  meta: { fontSize: Type.caption, fontVariant: ['tabular-nums'] },
  caption: { fontSize: Type.caption },
  /** Eyebrow above a title. */
  label: { fontSize: Type.footnote, fontWeight: '600' },
});

const DEFAULT_TONE: Partial<Record<TextVariant, TextTone>> = { meta: 'secondary', label: 'secondary' };

/** A variant's style object (no colour), for TextInput, animated text, or a nested style. */
export function textStyle(variant: TextVariant): TextStyle {
  return VARIANTS[variant];
}

/** The colour for a text tone. */
export function useToneColor(tone: TextTone): string {
  const theme = useTheme();
  return toneText(theme, tone);
}

function toneText(theme: ReturnType<typeof useTheme>, tone: TextTone): string {
  switch (tone) {
    case 'secondary': return theme.textSecondary;
    case 'tertiary': return theme.textTertiary;
    case 'tint': return theme.tint;
    case 'danger': return theme.danger;
    case 'warning': return theme.warning;
    case 'success': return theme.success;
    default: return theme.text;
  }
}

/** Text on the app's ramp. `color` (a team or priority colour) wins over `tone`. */
export function Text({ variant = 'body', tone, color, tabular, style, ...rest }: TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  color?: string;
  tabular?: boolean;
}) {
  const theme = useTheme();
  const c = color ?? toneText(theme, tone ?? DEFAULT_TONE[variant] ?? 'primary');
  return <RNText style={[VARIANTS[variant], { color: c }, tabular && styles.tabular, style]} {...rest} />;
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});

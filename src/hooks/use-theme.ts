/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, PriorityColor } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Tone } from '@/lib/status';

export function useThemeName(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useThemeName()];
}

export function usePriorityColors() {
  return PriorityColor[useThemeName()];
}

/** The colour for a status tone. Neutral reads as secondary text. */
export function toneColor(theme: ReturnType<typeof useTheme>, tone: Tone): string {
  switch (tone) {
    case 'tint': return theme.tint;
    case 'success': return theme.success;
    case 'warning': return theme.warning;
    case 'danger': return theme.danger;
    default: return theme.textSecondary;
  }
}

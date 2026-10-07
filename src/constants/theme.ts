/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Calm, flat palette: white canvas, white cards outlined by a hairline, one blue accent.
// No glass, no washes, no drop shadows. Change the look here; components only read tokens.
export const Colors = {
  light: {
    text: '#111827',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    background: '#FFFFFF',
    card: '#FFFFFF',
    backgroundElement: '#F1F3F6',
    backgroundSelected: '#E8EBF0',
    separator: '#ECEEF2',
    /** Hairline around cards and controls; replaces shadows. */
    border: '#E7E9EE',
    tint: '#2F6BF5',
    danger: '#E5484D',
    warning: '#F08C00',
    success: '#2BA36B',
    onTint: '#FFFFFF',
    /** Map */
    mapGround: '#F1F3F6',
    mapGrass: '#E2F2E8',
    mapPath: '#FFFFFF',
    mapWater: '#DCE9FB',
    mapBuilding: '#E5E8ED',
  },
  dark: {
    text: '#F3F4F6',
    textSecondary: '#A1A7B3',
    textTertiary: '#6B7280',
    background: '#0B0D10',
    card: '#15181D',
    backgroundElement: '#1C2027',
    backgroundSelected: '#242932',
    separator: '#22262D',
    border: '#252A32',
    tint: '#5B8DFF',
    danger: '#FF6369',
    warning: '#FFA94D',
    success: '#3DD68C',
    onTint: '#FFFFFF',
    mapGround: '#13161B',
    mapGrass: '#15241B',
    mapPath: '#232831',
    mapWater: '#142542',
    mapBuilding: '#1C2027',
  },
} as const;

/** The loop mark: mist on blue. Same in light and dark so the icon, splash and sign-in match. */
export const Brand = { blue: '#2F6BF5', mist: '#C9DCFF' } as const;

/** The voice gradient: sky → azure → cobalt. Used by the orb, transcripts and routes. */
export const VoiceGradient = ['#4FB2FF', '#3B86F7', '#2A5FE0'] as const;

/** P1 red, P2 orange, P3 neutral. Matches the lock-screen-glance rule: colour carries urgency. */
export const PriorityColor = {
  light: { P1: Colors.light.danger, P2: Colors.light.warning, P3: '#8E8E9E' },
  dark: { P1: Colors.dark.danger, P2: Colors.dark.warning, P3: '#8E8E9E' },
} as const;

export const Radius = { card: 16, control: 12, pill: 999 } as const;

/** One type scale for the whole app. Nudge these to make everything denser or roomier. */
export const Type = {
  hero: 22,
  title: 18,
  body: 15,
  callout: 14,
  footnote: 13,
  caption: 12,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;

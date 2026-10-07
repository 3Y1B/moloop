/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// THE palette. Every screen reads these tokens; no screen defines its own colours.
// Rules:
//  - One accent: `tint` (loop blue). Primary buttons are filled tint with `onTint` text. Nothing else is filled.
//  - Secondary controls are `backgroundElement` with `text`. Text-only actions use `tint`.
//  - Colour carries meaning, never decoration: `danger` = P1 / asked for help / 000, `warning` = waiting on someone,
//    `success` = done. No yellow, green, teal or indigo accents.
//  - Flat: white canvas, hairline borders, no gradients except the voice gradient, no drop shadows beyond `Shadow`
//    (only for things that float over the map or a track).
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
    /** Soft tint wash: selected rows, chosen chips, the minutes badge. Text on it is `tint`. */
    tintSoft: '#EAF0FE',
    danger: '#D92D20',
    dangerSoft: '#FDECEA',
    warning: '#C26A00',
    success: '#1F8A5B',
    onTint: '#FFFFFF',
    /** Dims the map behind a modal or a held voice bar. */
    scrim: 'rgba(17,24,39,0.36)',
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
    tintSoft: '#18233D',
    danger: '#FF6369',
    dangerSoft: '#3A1A1C',
    warning: '#FFA94D',
    success: '#3DD68C',
    onTint: '#FFFFFF',
    scrim: 'rgba(0,0,0,0.6)',
    mapGround: '#13161B',
    mapGrass: '#15241B',
    mapPath: '#232831',
    mapWater: '#142542',
    mapBuilding: '#1C2027',
  },
} as const;

/**
 * The loop mark: mist on blue. Same in light and dark so the icon, splash and sign-in match. `night` is the black
 * the finder searches on before it lights up `blue`.
 */
export const Brand = { blue: '#2F6BF5', mist: '#C9DCFF', night: '#0B0B0D' } as const;

/** The voice gradient: sky → azure → cobalt. Used by the orb, transcripts and routes. */
export const VoiceGradient = ['#4FB2FF', '#3B86F7', '#2A5FE0'] as const;

/** P1 red, P2 orange, P3 neutral. Matches the lock-screen-glance rule: colour carries urgency. */
export const PriorityColor = {
  light: { P1: Colors.light.danger, P2: Colors.light.warning, P3: '#8E8E9E' },
  dark: { P1: Colors.dark.danger, P2: Colors.dark.warning, P3: '#8E8E9E' },
} as const;

export const Radius = { card: 16, control: 12, pill: 999 } as const;

/**
 * The only shadows: style objects to spread or put in a style array. `sheet` lifts the bottom sheet off the map,
 * `floating` the round controls and pills over it, `tray` the voice dock's tray, `raised` the chosen segment.
 */
export const Shadow = {
  sheet: { boxShadow: '0 -6px 24px rgba(17, 24, 39, 0.08)' },
  floating: { boxShadow: '0 2px 10px rgba(17, 24, 39, 0.12)' },
  tray: { boxShadow: '0 4px 18px rgba(17, 24, 39, 0.06)' },
  raised: { boxShadow: '0 1px 3px rgba(17, 24, 39, 0.1)' },
} as const;

/** One type scale for the whole app. Nudge these to make everything denser or roomier. */
export const Type = {
  hero: 22,
  title: 18,
  /** Section headers ("Message", "Assigned to"). */
  headline: 17,
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

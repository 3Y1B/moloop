import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Opens the dialer. The app never places a call itself. */
export function callNumber(phone: string) {
  Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() => {});
}

/** Runs a repo command; a refused one (someone else got there first) buzzes instead of throwing. */
export async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    return false;
  }
}

/** Body of a lead formSheet: white canvas, scrolls, keeps taps while the keyboard is up. */
export function Sheet({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      {children}
    </ScrollView>
  );
}

/** Sheet heading: a small line above (what you're doing), then the title. */
export function SheetTitle({ eyebrow, title }: { eyebrow?: string; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.heading}>
      {eyebrow && <Text style={[styles.eyebrow, { color: theme.textSecondary }]} numberOfLines={1}>{eyebrow}</Text>}
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
    </View>
  );
}

/** A tappable row in an action card: icon, label, optional detail, chevron. */
export function ActionRow({ label, detail, sf, md, color, onPress, chevron = true }: {
  label: string;
  detail?: string;
  sf: string;
  md?: string;
  color?: string;
  onPress: () => void;
  chevron?: boolean;
}) {
  const theme = useTheme();
  const c = color ?? theme.tint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.icon, { backgroundColor: `${c}14` }]}>
        <Icon sf={sf} md={md} size={15} color={c} weight="medium" />
      </View>
      <View style={styles.body}>
        <Text style={[styles.label, { color: color ?? theme.text }]} numberOfLines={1}>{label}</Text>
        {detail && <Text style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={1}>{detail}</Text>}
      </View>
      {chevron && <Icon sf="chevron.right" md="chevron_right" size={12} color={theme.textTertiary} weight="medium" />}
    </Pressable>
  );
}

/** Inset that lines separators up with the row text, past the icon. */
export const ACTION_INSET = 56;

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 28, paddingBottom: 48, gap: 14 },
  heading: { gap: 2 },
  eyebrow: { fontSize: Type.footnote, fontWeight: '500' },
  title: { fontSize: Type.title, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 52 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 1 },
  label: { fontSize: Type.body, fontWeight: '500' },
  detail: { fontSize: Type.footnote - 1 },
});

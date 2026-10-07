import type { ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet } from 'react-native';

import { PageTitle } from '@/components/ui/page-title';
import { haptic } from '@/components/ui/pressable';
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
    haptic('error');
    return false;
  }
}

/** Body of a formSheet: white canvas, scrolls, keeps taps while the keyboard is up. */
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
  return <PageTitle size="sheet" eyebrow={eyebrow} title={title} />;
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 28, paddingBottom: 48, gap: 14 },
});

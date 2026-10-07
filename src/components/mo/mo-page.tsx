import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TaskDock } from '@/components/task/task-dock';
import { useDockHeight } from '@/components/voice/voice-dock';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  /** Stays under the top bar while the list scrolls past, like filters. */
  sticky?: ReactNode;
  children?: ReactNode;
};

/**
 * One of Mo's tabs: a plain full-height list under a title, with the assistant pinned at the bottom. The tab bar
 * already sits over the home indicator, so the dock doesn't pad for it again.
 */
export function MoPage(props: Props) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
      <Body {...props} />
    </SafeAreaInsetsContext.Provider>
  );
}

function Body({ title, sticky, children }: Props) {
  const theme = useTheme();
  const dock = useDockHeight();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        stickyHeaderIndices={sticky ? [1] : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: dock + Spacing.four }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
        {sticky && <View style={{ backgroundColor: theme.background }}>{sticky}</View>}
        {children}
      </ScrollView>
      <TaskDock />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // The same gutter as the sheet's content, so Mo's lists line up with a lead's.
  content: { paddingHorizontal: 20 },
  title: { fontSize: Type.hero, fontWeight: '700', paddingTop: Spacing.two },
});

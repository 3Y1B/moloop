import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TaskDock } from '@/components/task/task-dock';
import { PageTitle } from '@/components/ui/page-title';
import { useDockHeight } from '@/components/voice/voice-dock';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  /** Stays under the top bar while the list scrolls past, like filters. */
  sticky?: ReactNode;
  children?: ReactNode;
};

/**
 * Inside one of Mo's tabs. The tab bar already sits over the home indicator, so nothing in the tab (the dock) pads
 * for it again.
 */
export function TabInsets({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>{children}</SafeAreaInsetsContext.Provider>;
}

/** One of Mo's tabs: a plain full-height list under a title, with the assistant pinned at the bottom. */
export function MoPage(props: Props) {
  return (
    <TabInsets>
      <Body {...props} />
    </TabInsets>
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
        <PageTitle title={title} style={styles.title} />
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
  title: { paddingTop: Spacing.two },
});

import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { goBack } from '@/lib/navigation';

/**
 * Compact in-app header: back chevron, centred title, optional trailing action.
 * Drawn by us instead of the native navigation bar so it looks the same on every platform.
 */
export function ScreenHeader({
  title,
  back = false,
  backFallback,
  right,
}: {
  title: string;
  back?: boolean;
  backFallback?: Href;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top,
          backgroundColor: theme.background,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.side}>
          {back && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              onPress={() => goBack(backFallback)}
            >
              <Icon sf="chevron.left" md="chevron_left" size={18} color={theme.text} weight="medium" />
            </Pressable>
          )}
        </View>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  side: { width: 72, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontSize: Type.title - 1, fontWeight: '600' },
});

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './text';

/**
 * The title at the top of a page or sheet. `page`: the big one (Inbox, a Mo tab). `sheet`: a sheet's heading, with an
 * optional `eyebrow` above it saying what you're doing. `right` sits level with the title (e.g. "Read all").
 * No outer padding: the screen sets its own gutter.
 */
export function PageTitle({ title, eyebrow, right, size = 'page', align = 'left', style }: {
  title: string;
  eyebrow?: string;
  right?: ReactNode;
  size?: 'page' | 'sheet';
  align?: 'left' | 'center';
  style?: StyleProp<ViewStyle>;
}) {
  const center = align === 'center';
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.heading, center && styles.center]}>
        {eyebrow && <Text variant="label" numberOfLines={1}>{eyebrow}</Text>}
        <Text variant={size === 'page' ? 'hero' : 'title'} accessibilityRole="header" style={center && styles.centerText}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, gap: 2 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});

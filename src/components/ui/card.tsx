import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]} {...rest} />;
}

/**
 * Section: a plain title above a card. `count` sits right after the title in a quieter tone ("People 4");
 * `trailing` sits at the far right (a quiet string or number, or any node such as a text button).
 */
export function Section({ title, count, trailing, children, style, ...rest }: ViewProps & {
  title: string;
  count?: number;
  trailing?: string | number | ReactNode;
}) {
  return (
    <View style={[styles.section, style]} {...rest}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Text variant="section" accessibilityRole="header">{title}</Text>
          {count != null && <Text variant="section" tone="tertiary" tabular style={styles.quiet}>{count}</Text>}
        </View>
        {typeof trailing === 'string' || typeof trailing === 'number' ? (
          <Text variant="section" tone="tertiary" tabular style={styles.quiet}>{trailing}</Text>
        ) : (
          trailing
        )}
      </View>
      {children}
    </View>
  );
}

/** Hairline between rows. `inset` lines it up with the row text; `bleed` runs it edge to edge. */
export function Separator({ inset = 16, bleed }: { inset?: number; bleed?: boolean }) {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: bleed ? 0 : inset, backgroundColor: theme.separator }} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, borderCurve: 'continuous', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  section: { gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  quiet: { fontWeight: '500' },
});

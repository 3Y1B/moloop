import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]} {...rest} />;
}

/** Section: a quiet label above a card. */
export function Section({ title, trailing, children, style, ...rest }: ViewProps & { title: string; trailing?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, style]} {...rest}>
      <View style={styles.headerRow}>
        <Text style={[styles.header, { color: theme.text }]}>{title}</Text>
        {trailing && <Text style={[styles.header, { color: theme.textTertiary, fontWeight: '500' }]}>{trailing}</Text>}
      </View>
      {children}
    </View>
  );
}

export function Separator({ inset = 16 }: { inset?: number }) {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: theme.separator }} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, borderCurve: 'continuous', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  section: { gap: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  header: { fontSize: Type.title - 1, fontWeight: '600', letterSpacing: -0.2 },
});

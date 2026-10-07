import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Only the summary is visible until Mo opens this section; draft values stay in the parent. */
export function PlanningSection({ title, summary, children, disabled }: {
  title: string; summary: string; children: ReactNode; disabled?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} settings`}
        accessibilityHint={summary}
        accessibilityState={{ expanded: open, disabled }}
        aria-expanded={open}
        disabled={disabled}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.header, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.summary, { color: theme.textSecondary }]}>{summary}</Text>
        </View>
        <Icon sf={open ? 'chevron.up' : 'chevron.down'} md={open ? 'expand_less' : 'expand_more'} size={18} color={theme.textSecondary} />
      </Pressable>
      {open && <View style={[styles.content, { borderTopColor: theme.border }]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: Radius.control, overflow: 'hidden' },
  header: { minHeight: 68, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: Type.title - 1, fontWeight: '600' },
  summary: { fontSize: Type.footnote, lineHeight: 18 },
  content: { padding: 14, gap: 14, borderTopWidth: StyleSheet.hairlineWidth },
});

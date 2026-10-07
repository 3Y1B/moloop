import { StyleSheet, Text } from 'react-native';

import { Type } from '@/constants/theme';
import { quoteFor } from '@/lib/quote';
import type { Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * Beside a task's title when the AI was down: the title is the reporter's own words, untranslated. Nothing otherwise.
 * It never truncates, so it stays readable next to a long title.
 */
export function Untranslated({ task }: { task: Task }) {
  const theme = useTheme();
  const label = quoteFor(task.reporter).label;
  if (label !== 'Not translated') return null;
  return <Text style={[styles.tag, { color: theme.textTertiary }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0, fontSize: Type.caption },
});

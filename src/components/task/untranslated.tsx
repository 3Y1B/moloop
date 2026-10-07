import { StyleSheet } from 'react-native';

import { Text } from '@/components/ui/text';
import { quoteFor } from '@/lib/quote';
import type { Task } from '@/lib/schema';

/**
 * Beside a task's title when the AI was down: the title is the reporter's own words, untranslated. Nothing otherwise.
 * It never truncates, so it stays readable next to a long title.
 */
export function Untranslated({ task }: { task: Task }) {
  const label = quoteFor(task.reporter).label;
  if (label !== 'Not translated') return null;
  return <Text variant="caption" tone="tertiary" style={styles.tag}>{label}</Text>;
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0 },
});

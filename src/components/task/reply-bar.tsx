import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import type { HelperAssignment, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';
import { useReplyOptions } from './reply-options';

export { openCrewMessage, openGuestReply, useSendReply } from './reply-options';

/** One big obvious next step, then compact alternatives. Designed for one thumb while walking. */
export function ReplyBar({ task, helperEntry }: { task: Task; helperEntry?: HelperAssignment }) {
  const theme = useTheme();
  const { primary, alternatives } = useReplyOptions(task, helperEntry);
  return (
    <View style={styles.wrap}>
      {primary && (
        <Button size="large" label={primary.label} sf={primary.sf} haptic={primary.haptic} onPress={primary.onPress} />
      )}
      {alternatives.length > 0 && (
        <View style={styles.row}>
          {alternatives.map((o) => (
            <Button
              key={o.key}
              variant="tinted"
              size="small"
              label={o.label}
              sf={o.sf}
              tone={o.tone}
              // Quiet, but still readable on the wash.
              color={o.tone === 'neutral' ? theme.textSecondary : undefined}
              haptic={o.haptic}
              onPress={o.onPress}
              style={styles.flex}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flexGrow: 1, flexShrink: 1, paddingHorizontal: 10 },
});

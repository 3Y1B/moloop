import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { useRepo } from '@/data/hooks';
import { REPLY_LABEL, REPLY_SF } from '@/lib/format';
import { availableReplies } from '@/lib/lifecycle';
import type { ReplyKind, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/** One big obvious next step, then compact alternatives. Designed for one thumb while walking. */
export function ReplyBar({ task }: { task: Task }) {
  const repo = useRepo();
  const theme = useTheme();
  const { primary, secondary } = availableReplies(task.status);
  // Done and Need help open the voice/type sheet so the reply carries what happened; accept/decline are instant.
  const send = (r: ReplyKind) =>
    r === 'done' || r === 'need_help'
      ? router.push({ pathname: '/reply/[id]', params: { id: task.id, kind: r } })
      : repo.reply(task.id, r);

  const colorFor = (r: ReplyKind) =>
    r === 'need_help' ? theme.danger : r === 'done' ? theme.success : r === 'decline' ? theme.textSecondary : theme.tint;
  const hapticFor = (r: ReplyKind) => (r === 'need_help' || r === 'decline' ? 'warning' : r === 'done' ? 'success' : 'light');

  // "Still on it" lives in the check-in line ("Update") and in voice, not as a permanent button.
  const inline = secondary.filter((r) => r !== 'still_on_it');
  return (
    <View style={styles.wrap}>
      {primary && (
        <Button
          size="large"
          label={REPLY_LABEL[primary]}
          sf={REPLY_SF[primary]}
          color={colorFor(primary)}
          haptic={hapticFor(primary)}
          onPress={() => send(primary)}
        />
      )}
      {inline.length > 0 && (
        <View style={styles.row}>
          {inline.map((r) => (
            <Button
              key={r}
              variant="tinted"
              size="small"
              label={REPLY_LABEL[r]}
              sf={REPLY_SF[r]}
              color={colorFor(r)}
              haptic={hapticFor(r)}
              onPress={() => send(r)}
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

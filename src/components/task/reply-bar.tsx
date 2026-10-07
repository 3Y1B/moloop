import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { useRepo } from '@/data/hooks';
import { REPLY_LABEL, REPLY_SF } from '@/lib/format';
import { availableReplies } from '@/lib/lifecycle';
import type { ReplyKind, Task } from '@/lib/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * One big obvious next step, then compact alternatives. Designed for one thumb while walking.
 * A helper (backup) only gets Done; asking for help stays with the owner. Tasks from a festival-goer get Reply.
 */
export function ReplyBar({ task, helping = false }: { task: Task; helping?: boolean }) {
  const theme = useTheme();
  const { primary, secondary } = availableReplies(task.status);
  const send = useSendReply(task);

  // The main reply is the screen's one filled (tint) button; colour on the alternatives carries meaning.
  const colorFor = (r: ReplyKind) =>
    r === 'need_help' ? theme.danger : r === 'decline' ? theme.textSecondary : theme.tint;
  const hapticFor = (r: ReplyKind) => (r === 'need_help' || r === 'decline' ? 'warning' : r === 'done' ? 'success' : 'light');

  // "Still on it" lives in the status line ("Send an update") and in voice, not as a permanent button.
  const inline = helping ? [] : secondary.filter((r) => r !== 'still_on_it');
  // Reply to the festival-goer once you've taken it (a typed or voice note into their thread).
  const canReplyToGuest = !!task.requestId && task.status !== 'assigned';
  return (
    <View style={styles.wrap}>
      {primary && (
        <Button
          size="large"
          label={REPLY_LABEL[primary]}
          sf={REPLY_SF[primary]}
          haptic={hapticFor(primary)}
          onPress={() => send(primary)}
        />
      )}
      {(inline.length > 0 || canReplyToGuest) && (
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
          {canReplyToGuest && (
            <Button
              variant="tinted"
              size="small"
              label="Reply"
              sf="arrowshape.turn.up.left.fill"
              color={theme.tint}
              onPress={() => openGuestReply(task)}
              style={styles.flex}
            />
          )}
        </View>
      )}
    </View>
  );
}

/** Done and Need help open the voice/type sheet so the reply carries what happened; accept/decline are instant. */
export function useSendReply(task: Task) {
  const repo = useRepo();
  return (r: ReplyKind) =>
    r === 'done' || r === 'need_help'
      ? router.push({ pathname: '/reply/[id]', params: { id: task.id, kind: r } })
      : repo.reply(task.id, r);
}

/** Reply to the festival-goer once you've taken it (a typed or voice note into their thread). */
export const openGuestReply = (task: Task) =>
  router.push({ pathname: '/reply/[id]', params: { id: task.id, kind: 'guest_reply' } });

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flexGrow: 1, flexShrink: 1, paddingHorizontal: 10 },
});

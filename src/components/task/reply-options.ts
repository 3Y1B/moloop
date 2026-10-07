import { router } from 'expo-router';

import { useRepo } from '@/data/hooks';
import { REPLY_LABEL, REPLY_SF } from '@/lib/format';
import { availableHelperReplies, availableReplies } from '@/lib/lifecycle';
import type { HelperAssignment, ReplyKind, Task } from '@/lib/schema';

/** One reply a volunteer can make from a button. `tone` is what its colour means: tint, danger, or quiet. */
export type ReplyOption = {
  key: ReplyKind | 'guest_reply';
  label: string;
  sf: string;
  tone: 'tint' | 'danger' | 'neutral';
  haptic: 'success' | 'warning' | 'light';
  onPress: () => void;
};

/**
 * The replies a task offers its volunteer, for every layout that shows them: one main reply, then the alternatives.
 * Helpers reply against their own assignment: Accept/Decline while notified, Done once accepted. Asking for help stays
 * with the owner. "Still on it" lives in the status line and in voice, not as a button. A task from a festival-goer
 * gets Reply once it's taken.
 */
export function useReplyOptions(task: Task, helperEntry?: HelperAssignment): {
  primary: ReplyOption | null;
  alternatives: ReplyOption[];
} {
  const send = useSendReply(task);
  const { primary, secondary } = helperEntry ? availableHelperReplies(helperEntry.status) : availableReplies(task.status);
  const option = (r: ReplyKind): ReplyOption => ({
    key: r,
    label: REPLY_LABEL[r],
    sf: REPLY_SF[r],
    tone: r === 'need_help' ? 'danger' : r === 'decline' ? 'neutral' : 'tint',
    haptic: r === 'need_help' || r === 'decline' ? 'warning' : r === 'done' ? 'success' : 'light',
    onPress: () => send(r),
  });
  const alternatives = secondary.filter((r) => r !== 'still_on_it').map(option);
  if (task.requestId && task.status !== 'assigned') {
    alternatives.push({
      key: 'guest_reply',
      label: 'Reply',
      sf: 'arrowshape.turn.up.left.fill',
      tone: 'tint',
      haptic: 'light',
      onPress: () => openGuestReply(task),
    });
  }
  return { primary: primary ? option(primary) : null, alternatives };
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

/** A lead's message to whoever is on the task. */
export const openCrewMessage = (task: Task) =>
  router.push({ pathname: '/reply/[id]', params: { id: task.id, kind: 'crew_message' } });

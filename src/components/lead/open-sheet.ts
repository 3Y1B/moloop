import { router } from 'expo-router';

import type { NeedsItem } from '@/data/hooks';
import { isQuiet, needsResponse } from '@/lib/lifecycle';
import type { Proposal, Task } from '@/lib/schema';

/**
 * Where tapping a task takes a lead: the approval if the AI is waiting on one, the picker if nobody has it,
 * the Respond sheet if someone needs an answer (or a handover is waiting on Arrived), else the task page.
 */
export function openTaskSheet(task: Task, proposals: Record<string, Proposal>) {
  const pending = Object.values(proposals).find((p) => p.taskId === task.id && p.status === 'pending');
  if (pending) return router.push({ pathname: '/approve/[id]', params: { id: pending.id } });
  if (task.status === 'open') return router.push({ pathname: '/assign/[id]', params: { id: task.id, mode: 'assign' } });
  if (needsResponse(task) || isQuiet(task) || (task.status === 'escalated' && task.escalation?.response?.kind === 'handover')) {
    return router.push({ pathname: '/respond/[id]', params: { id: task.id } });
  }
  router.push({ pathname: '/task/[id]', params: { id: task.id } });
}

/** Where a "Needs you" item goes: the approval, the picker (nobody has it, or it was held back), else Respond. */
export function openNeed(item: NeedsItem) {
  if (item.kind === 'mobilization') {
    return router.push({ pathname: '/mobilize/[id]', params: { id: item.mobilization.id } });
  }
  const { kind, task, proposal } = item;
  if (kind === 'approval' && proposal) return router.push({ pathname: '/approve/[id]', params: { id: proposal.id } });
  if (kind === 'unassigned' || kind === 'escalated') {
    return router.push({ pathname: '/assign/[id]', params: { id: task.id, mode: 'assign' } });
  }
  router.push({ pathname: '/respond/[id]', params: { id: task.id } });
}

/** The one action word for a "Needs you" item, as its button says it. */
export function needVerb(item: NeedsItem) {
  switch (item.kind) {
    case 'mobilization': return 'Review';
    case 'approval': return 'Approve';
    case 'unassigned':
    case 'escalated': return 'Assign';
    case 'handover': return 'Arrived';
    default: return 'Respond';
  }
}

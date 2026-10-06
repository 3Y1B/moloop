import { router } from 'expo-router';

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

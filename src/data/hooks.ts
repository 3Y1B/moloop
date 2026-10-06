import { useMemo } from 'react';

import { isActive } from '@/lib/lifecycle';
import { routeBetween } from '@/lib/route';
import type { Task } from '@/lib/schema';
import { useSnapshot } from './provider';

export { useRepo, useSnapshot } from './provider';

const byPriorityThenAge = (a: Task, b: Task) => a.priority.localeCompare(b.priority) || a.createdAt - b.createdAt;

export function useNow() {
  return useSnapshot().now;
}

export function useMe() {
  const s = useSnapshot();
  return s.meId ? s.volunteers[s.meId] : undefined;
}

/** Everything the volunteer home screen needs, derived once per snapshot. */
export function useMyWork() {
  const s = useSnapshot();
  return useMemo(() => {
    const mine = Object.values(s.tasks).filter((t) => t.assigneeId === s.meId);
    return {
      active: mine.find(isActive),
      queue: mine.filter((t) => t.status === 'queued').sort(byPriorityThenAge),
      done: mine.filter((t) => t.status === 'resolved').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    };
  }, [s.tasks, s.meId]);
}

export function useTask(id: string | undefined) {
  const s = useSnapshot();
  return id ? s.tasks[id] : undefined;
}

export function useTaskEvents(taskId: string | undefined) {
  const s = useSnapshot();
  return useMemo(() => s.events.filter((e) => e.taskId === taskId).sort((a, b) => a.at - b.at), [s.events, taskId]);
}

export function useInbox() {
  const s = useSnapshot();
  return useMemo(() => {
    const messages = s.messages.filter((m) => m.recipientId === s.meId).sort((a, b) => b.at - a.at);
    return { messages, unread: messages.filter((m) => !m.read).length };
  }, [s.messages, s.meId]);
}

export function useLookups() {
  const s = useSnapshot();
  return { teams: s.teams, zones: s.zones, volunteers: s.volunteers };
}

/** Walking route from where I am to a task's location. Null if either end is unknown. */
export function useRouteTo(task: Task | undefined) {
  const me = useMe();
  const from = me?.zoneSlug ?? null;
  return useMemo(
    () => (task ? routeBetween(from, task.zoneSlug, task.locationHint) : null),
    [from, task?.zoneSlug, task?.locationHint], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

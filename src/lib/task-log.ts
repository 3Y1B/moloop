import { isActive } from './lifecycle';
import type { Task, TaskEvent, TeamSlug } from './schema';

export type LogStatus = 'all' | 'open' | 'active' | 'done';
export type LogFilter = { status: LogStatus; team: TeamSlug | null };
export type LogRow = { task: Task; last?: TaskEvent };
export type LogCounts = { total: number; open: number; active: number; done: number };

type World = { tasks: Record<string, Task>; events: TaskEvent[] };

const STATUS: Record<Exclude<LogStatus, 'all'>, (t: Task) => boolean> = {
  open: (t) => t.status === 'open' || t.status === 'queued',
  active: isActive,
  done: (t) => t.status === 'resolved' || t.status === 'cancelled',
};

/**
 * Every task this shift with its newest event, the most recent activity first: Mo's Tasks tab. Filtered by status
 * and team; the counts cover the team (or everyone) whatever the status filter, so they can sit on the filters.
 */
export function taskLog(s: World, filter: LogFilter): { rows: LogRow[]; counts: LogCounts } {
  const last = new Map<string, TaskEvent>();
  for (const e of s.events) {
    const seen = last.get(e.taskId);
    if (!seen || e.at >= seen.at) last.set(e.taskId, e);
  }
  const team = Object.values(s.tasks).filter((t) => filter.team === null || t.teamSlug === filter.team);
  const activity = (r: LogRow) => Math.max(r.last?.at ?? 0, r.task.lastActivityAt);
  const rows = team
    .filter((t) => filter.status === 'all' || STATUS[filter.status](t))
    .map((task) => ({ task, last: last.get(task.id) }))
    .sort((a, b) => activity(b) - activity(a));
  return {
    rows,
    counts: {
      total: team.length,
      open: team.filter(STATUS.open).length,
      active: team.filter(STATUS.active).length,
      done: team.filter(STATUS.done).length,
    },
  };
}

/** A log row's newest event: "Priya: Accepted" for a reply, the event as written otherwise. The row shows when. */
export function lastLine(e: TaskEvent): string {
  return e.reply && e.actor.name ? `${e.actor.name.split(' ')[0]}: ${e.text}` : e.text;
}

import { lastLine, taskLog } from './task-log';
import { TEAM_SLUGS, type Task, type TaskEvent, type TeamSlug } from './schema';

/** One fact in a summary, linked to the task or team it's about when there is one. */
export type SummaryPoint = { text: string; taskId?: string; teamSlug?: TeamSlug };
/** What the model returns, before it's checked. */
export type RawSummary = { headline: string; points: { text: string; taskId?: string; teamSlug?: string }[] };

export const MAX_POINTS = 3;

/** A summary as the app shows it. `ai: false` is the plain-count fallback, shown without the AI mark. */
export type Summary = { headline: string; points: SummaryPoint[]; ai: boolean; at: number };

/** What to summarise: the whole shift, or one task. */
export type SummaryScope = { scope: 'shift' } | { scope: 'task'; taskId: string };

/**
 * The model's summary, made safe to show: trimmed, at most three points, and a link only to a task or team that
 * exists (a made-up one is dropped, the point kept). Nothing to say (no headline): null.
 */
export function checkSummary(raw: RawSummary, s: { tasks: Record<string, Task> }): { headline: string; points: SummaryPoint[] } | null {
  const headline = raw.headline.trim();
  if (!headline) return null;
  const points = raw.points
    .map((p) => ({
      text: p.text.trim(),
      ...(p.taskId && s.tasks[p.taskId] ? { taskId: p.taskId } : {}),
      ...(p.teamSlug && (TEAM_SLUGS as readonly string[]).includes(p.teamSlug) ? { teamSlug: p.teamSlug as TeamSlug } : {}),
    }))
    .filter((p) => p.text)
    .slice(0, MAX_POINTS);
  return { headline, points };
}

/**
 * When the model is down or slow: plain facts from the snapshot, no AI text. The shift's counts, or a task's latest
 * event. The card shows these the same way, without the AI mark.
 */
export function fallbackSummary(s: { tasks: Record<string, Task>; events: TaskEvent[] }, scope: SummaryScope): { headline: string; points: SummaryPoint[] } {
  if (scope.scope === 'shift') {
    const { counts: c } = taskLog(s, { status: 'all', team: null });
    return { headline: `${c.total} tasks: ${c.open} open, ${c.active} active, ${c.done} done`, points: [] };
  }
  const newest = s.events.filter((e) => e.taskId === scope.taskId).reduce<TaskEvent | undefined>((a, e) => (!a || e.at >= a.at ? e : a), undefined);
  return { headline: newest ? `Latest: ${lastLine(newest)}` : 'No updates yet', points: [] };
}

import { routeBetween } from '@/lib/route';
import type { Task } from '@/lib/schema';

/**
 * Open tasks a new report might be about, before it becomes a task of its own (re-triage, docs/PLAN-LIVE.md phase 6).
 * Nearby means the same zone or a short walk away: neighbouring zones on the oval are 25 to 100 m apart.
 */

const NEAR_M = 100;
const RECENT_MS = 20 * 60_000;
const MAX = 5;

const walk = (from: string | null, to: string | null) => (from === to ? 0 : routeBetween(from, to)?.meters ?? Infinity);

export function nearbyOpenTasks(tasks: Task[], zoneSlug: string | null, now: number): Task[] {
  return tasks
    // Mobilization actions are coordinated operations, not incident reports to merge new reports into.
    .filter((t) => !t.mobilizationId && t.status !== 'resolved' && t.status !== 'cancelled' && now >= t.createdAt && now - t.createdAt <= RECENT_MS)
    .map((t) => ({ t, m: walk(zoneSlug, t.zoneSlug) }))
    .filter(({ m }) => m <= NEAR_M)
    .sort((a, b) => a.m - b.m)
    .slice(0, MAX)
    .map(({ t }) => t);
}

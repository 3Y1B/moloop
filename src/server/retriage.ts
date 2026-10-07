import type { Task } from '@/lib/schema';
import { nearbyOpenTasks } from '@/lib/nearby';
import { interpreter } from './models/interpreter';

/**
 * Re-triage (docs/PLAN-LIVE.md phase 6): before a report becomes a task, ask whether it's about one already open
 * nearby. Outside the world lock, like every model call; the command checks the task is still open when it lands.
 */
export function matchOpen(tasks: Task[], i: { text: string; zoneSlug: string | null; locationHint: string | null; urgent?: boolean }) {
  return interpreter.match({ ...i, candidates: nearbyOpenTasks(tasks, i.zoneSlug, Date.now()) });
}

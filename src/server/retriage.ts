import type { Task } from '@/lib/schema';
import { nearbyOpenTasks } from '@/lib/nearby';
import { interpreter } from './models/interpreter';
import { read } from './world';

/**
 * Re-triage (docs/PLAN-LIVE.md phase 6): before a report becomes a task, ask whether it's about one already open
 * nearby. Outside the world lock, like every model call; the command checks the task is still open when it lands.
 */
export function matchOpen(tasks: Task[], i: { text: string; zoneSlug: string | null; locationHint: string | null; urgent?: boolean }) {
  return interpreter.match({ ...i, candidates: nearbyOpenTasks(tasks, i.zoneSlug, Date.now()) });
}

/**
 * A volunteer's (or lead's) voice report, judged before the world lock is taken: the intake agent (who's reporting,
 * from where they're standing; the place they name, if any, wins), then whether it's about something already open.
 * A crew report goes ahead of festival-goers' requests in the model queue.
 */
export async function judgeReport(callerId: string, callerRole: string, heard: string) {
  const me = await read({}, ({ world }) => world.volunteers[callerId]);
  const judged = await interpreter.triage({
    text: heard, zoneSlug: me?.zoneSlug ?? null, locationHint: null, urgent: true,
    from: { kind: 'staff', role: me?.role ?? callerRole, teamSlug: me?.teamSlug ?? null },
  });
  const matched = await read({}, ({ world }) => world).then((w) => matchOpen(Object.values(w.tasks), {
    text: heard, zoneSlug: judged.value.zoneSlug ?? w.volunteers[callerId]?.zoneSlug ?? null, locationHint: judged.value.locationHint, urgent: true,
  }));
  return { judged, matched };
}

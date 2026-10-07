import type { Batch } from '@/lib/batch';
import { eligible, laneCandidates } from '@/lib/candidates';
import { isBusy } from '@/lib/lifecycle';
import * as C from '@/lib/commands';
import { pickCrew, rankQualified } from './models/picker';
import { read, transact } from './world';

/**
 * The picker step of a P1/P2 proposal, run after it's saved so the lead's approve sheet is up straight away with the
 * rules' order. Outside the world lock, like every model call: from one snapshot, the model ranks everyone free by
 * profile (no distance), the two lanes make the shortlist (lib/candidates.ts) with the language intake said is needed,
 * the model picks from it, and its answer goes in as one command, which does nothing if someone has decided meanwhile.
 * Both runs are logged on the task's report. If the ranking fails, the qualified lane is the rules' order.
 */

/** How many each lane gives the model to weigh (up to twice this, with nobody in both), and how many the approve sheet lists. */
const LANE = 6;
const PROPOSED = 5;

const inFlight = new Set<string>();

export async function pickFor(proposalId: string) {
  if (inFlight.has(proposalId)) return;
  inFlight.add(proposalId);
  try {
    const got = await read({ proposalIds: [proposalId] }, ({ world }) => {
      const p = world.proposals[proposalId];
      const task = p && world.tasks[p.taskId];
      if (p?.status !== 'pending' || task?.status !== 'open') return null;
      return { task, volunteers: Object.values(world.volunteers), tasks: Object.values(world.tasks), positions: world.positions, teams: world.teams };
    });
    if (!got) return;
    const { task, volunteers, tasks, positions, teams } = got;
    const on = eligible(task, volunteers);
    const free = on.filter((v) => !isBusy(tasks, v.id));
    const qualified = await rankQualified(task, free.length ? free : on, teams);
    const shortlist = laneCandidates(task, volunteers, tasks, { qualified: qualified.value, size: LANE, positions })
      .map((candidate) => ({ candidate, volunteer: volunteers.find((v) => v.id === candidate.volunteerId)! }));
    const { value, run } = await pickCrew(task, shortlist, teams);
    const byId = new Map(shortlist.map((s) => [s.candidate.volunteerId, s.candidate]));
    await transact({ proposalIds: [proposalId], taskIds: [task.id] }, (b) => {
      if (value) C.rerank(b, proposalId, value.order.slice(0, PROPOSED).map((id) => byId.get(id)!), value.people);
    }, { run: { ...run, taskId: task.id }, before: [qualified.run] });
  } finally {
    inFlight.delete(proposalId);
  }
}

/** After a commit: proposals it just made (created at the batch's own `now`) get picked for. */
export function pickNewProposals(b: Batch) {
  for (const p of Object.values(b.proposals)) {
    if (p.status !== 'pending' || p.createdAt !== b.now) continue;
    setTimeout(() => pickFor(p.id).catch((e) => console.error(`pick ${p.id} failed`, e)), 0);
  }
}

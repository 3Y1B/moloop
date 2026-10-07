import type { Batch } from '@/lib/batch';
import { PLAYBOOK_SLUGS, type PlaybookSlug } from '@/lib/mobilization-contracts';
import type { MobilizationCause, Task } from '@/lib/schema';
import { planMobilization } from './predict/plan';
import { TRIGGERED_PROMPT_VERSION } from './predict/planning-request';
import { mobilizationStaleRunTimeoutMs } from './predict/timeouts';
import { sql } from './world';

/**
 * What starts the mobilization planner (docs/plans/2026-10-08-mobilization-plan.md, "Triggers"). Nothing runs in the
 * background guessing: something real arrives, names one playbook for one zone, and the planner drafts one plan for
 * Mo (src/server/predict/plan.ts).
 *
 *  - T1, a serious report: intake read it as a playbook, and it's P1 or intake is sure.
 *  - T4, Mo says so: Mo's own report naming a playbook. Same path as T1.
 *  - T2 (reports adding up) and T3 (a reading over a line) come in through `fire` too, with their own causes. Not yet.
 *
 * One plan per playbook and zone: while one is being planned, waiting for Mo or running, a trigger adds its cause to
 * that plan's evidence instead of starting another. Dismissed means quiet: for 15 minutes after Mo dismisses one, the
 * same playbook and zone doesn't come back, unless a P1 report (or Mo) names it.
 */

export const QUIET_MS = 15 * 60_000;

export type Trigger = {
  playbook: PlaybookSlug;
  zoneSlug: string | null;
  cause: MobilizationCause;
  /** It may start a plan, not only add to one. */
  strong: boolean;
  /** It comes through a dismissal's quiet. */
  urgent: boolean;
};

/** The database side of `fire`, inside one transaction per playbook and zone (an in-memory fake in tests). */
export type Plans = {
  /** Add the cause to the open plan for this playbook and zone. False when there's none. */
  join(): Promise<boolean>;
  /** When Mo last dismissed a plan for this playbook and zone, else null. */
  dismissedAt(): Promise<number | null>;
  /** Save a run for the planner; its id. */
  start(): Promise<string>;
};
export type WithPlans = <T>(t: Trigger, fn: (plans: Plans) => Promise<T>) => Promise<T>;

const isPlaybook = (slug: string | null | undefined): slug is PlaybookSlug =>
  (PLAYBOOK_SLUGS as readonly (string | null | undefined)[]).includes(slug);

/** T1 and T4: what a new report names, or null. `byMo`: Mo filed it. */
export function reportTrigger(task: Task, byMo: boolean): Trigger | null {
  const playbook = task.reporter.playbook;
  if (task.mobilizationId || !isPlaybook(playbook)) return null;
  const p1 = task.priority === 'P1';
  return {
    playbook,
    zoneSlug: task.zoneSlug,
    cause: { kind: 'report', taskId: task.id, title: task.title, zoneSlug: task.zoneSlug, priority: task.priority,
      at: task.createdAt },
    // Decision 4: one report that isn't P1 starts a plan only when intake is sure. Anything weaker waits for T2.
    strong: p1 || byMo || task.reporter.playbookSure === true,
    urgent: p1 || byMo,
  };
}

/** Join the open plan, start one, or stay quiet. The new run's id when it started one; the planner is on its way. */
export async function fire(t: Trigger, withPlans: WithPlans = inDatabase): Promise<string | null> {
  const runId = await withPlans(t, async (plans) => {
    if (await plans.join()) return null;
    if (!t.strong) return null;
    const dismissed = await plans.dismissedAt();
    if (dismissed != null && t.cause.at - dismissed < QUIET_MS && !t.urgent) return null;
    return plans.start();
  });
  // Off the report's path: the reporter's confirmation doesn't wait for a plan.
  if (runId) setTimeout(() => planMobilization(runId).catch((e) => console.error(`plan ${runId} failed`, e)), 0);
  return runId;
}

export function onReport(task: Task, byMo: boolean, withPlans?: WithPlans): Promise<string | null> {
  const t = reportTrigger(task, byMo);
  return t ? fire(t, withPlans) : Promise.resolve(null);
}

/** After a commit: reports it just filed (created at the batch's own `now`) that name a playbook. */
export function planNewReports(b: Batch) {
  const fresh = Object.values(b.tasks).filter((t) => t.createdAt === b.now && t.reporter.playbook && !t.mobilizationId);
  if (!fresh.length) return;
  const filedBy = (t: Task) => b.events.find((e) => e.taskId === t.id && e.kind === 'created')?.actor.id;
  setTimeout(async () => {
    for (const t of fresh) {
      const by = filedBy(t);
      await onReport(t, !!by && b.volunteers[by]?.role === 'coordinator').catch((e) =>
        console.error(`trigger for ${t.id} failed`, e),
      );
    }
  }, 0);
}

/** One trigger at a time per playbook and zone, so two reports at once can't both start a plan. */
async function inDatabase<T>(t: Trigger, fn: (plans: Plans) => Promise<T>): Promise<T> {
  const out = await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`moloop:trigger:${t.playbook}:${t.zoneSlug ?? ''}`}))`;
    const zone = t.zoneSlug;
    return fn({
      async join() {
        const cause = tx.json([t.cause] as Parameters<typeof tx.json>[0]);
        // A run whose planner died (a restart) doesn't hold the place.
        const staleMs = mobilizationStaleRunTimeoutMs(process.env.MOBILIZATION_MODEL_TIMEOUT_MS);
        await tx`update mobilization_runs set status = 'failed', error = 'Generation was interrupted',
          updated_at = clock_timestamp()
          where playbook = ${t.playbook} and zone_slug is not distinct from ${zone} and status = 'running'
            and updated_at < clock_timestamp() - (${staleMs} * interval '1 millisecond')`;
        // The planner copies its run's causes onto the plan under a lock on the run: a cause lands on one or the other.
        const runs = await tx`update mobilization_runs set causes = causes || ${cause}::jsonb
          where playbook = ${t.playbook} and zone_slug is not distinct from ${zone} and status = 'running'
          returning id`;
        if (runs.length) return true;
        const plans = await tx`update mobilizations set causes = causes || ${cause}::jsonb
          where trigger_playbook = ${t.playbook} and status in ('proposed', 'active')
            and zone_id is not distinct from (select id from zones where slug = ${zone})
          returning id`;
        return plans.length > 0;
      },
      async dismissedAt() {
        const [row] = await tx<{ at: string | null }[]>`
          select extract(epoch from max(decided_at)) * 1000 as at from mobilizations
          where trigger_playbook = ${t.playbook} and status = 'rejected'
            and zone_id is not distinct from (select id from zones where slug = ${zone})`;
        return row?.at == null ? null : Number(row.at);
      },
      async start() {
        const [run] = await tx<{ id: string }[]>`
          insert into mobilization_runs ${tx({
            request_id: crypto.randomUUID(),
            status: 'running',
            prompt_version: TRIGGERED_PROMPT_VERSION,
            playbook: t.playbook,
            zone_slug: zone,
            causes: tx.json([t.cause] as Parameters<typeof tx.json>[0]),
          })} returning id`;
        return run.id;
      },
    });
  });
  return out as T;
}

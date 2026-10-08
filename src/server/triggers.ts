import { z } from 'zod';
import type { Batch } from '@/lib/batch';
import { PLAYBOOK_SLUGS, type PlaybookSlug } from '@/lib/mobilization-contracts';
import { observationDefinition } from '@/lib/mobilization-observations';
import type { MobilizationCause, ReadingValue, Task } from '@/lib/schema';
import { generate } from './models';
import { FESTIVAL_PLAYBOOKS, type PlaybookTrigger } from './playbooks/festival';
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
 *  - T2, reports adding up: a new report makes 3+ in one zone within 10 minutes, with no plan there yet. One model
 *    call per zone per window (trigger_checks) says whether a playbook applies; all those reports are its causes.
 *  - T3, a reading over a line: a playbook's `triggers` (./playbooks/festival.ts). Rules, not AI.
 *
 * One plan per playbook and zone: while one is being planned, waiting for Mo or running, a trigger adds its cause to
 * that plan's evidence instead of starting another. Dismissed means quiet: for 15 minutes after Mo dismisses one, the
 * same playbook and zone doesn't come back, unless a P1 report (or Mo) names it.
 */

export const QUIET_MS = 15 * 60_000;

export type Trigger = {
  playbook: PlaybookSlug;
  zoneSlug: string | null;
  /** What set it off: one report or reading, or the reports that added up (T2). */
  causes: MobilizationCause[];
  /** When, for the dismissal's quiet: the newest cause. */
  at: number;
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

type ReportCause = Extract<MobilizationCause, { kind: 'report' }>;
const reportCause = (task: Task): ReportCause => ({ kind: 'report', taskId: task.id, title: task.title,
  zoneSlug: task.zoneSlug, priority: task.priority, at: task.createdAt });

/** T1 and T4: what a new report names, or null. `byMo`: Mo filed it. */
export function reportTrigger(task: Task, byMo: boolean): Trigger | null {
  const playbook = task.reporter.playbook;
  if (task.mobilizationId || !isPlaybook(playbook)) return null;
  const p1 = task.priority === 'P1';
  return {
    playbook,
    zoneSlug: task.zoneSlug,
    causes: [reportCause(task)],
    at: task.createdAt,
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
    if (dismissed != null && t.at - dismissed < QUIET_MS && !t.urgent) return null;
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

/** A reading older than this never fires. The planner reads the same 30 minutes (READING_WINDOW_MS, ./predict/plan). */
export const STALE_MS = 30 * 60_000;

/** One stored reading (./http/readings.ts), its value as the catalog's kind has it. */
export type Reading = {
  id: string;
  key: string;
  zoneSlug: string | null;
  value: unknown;
  observedAt: number;
  source: 'sensor' | 'simulated';
};
/** What a rule needs to know about a place: zones.kind and zones.capacity. */
export type Place = { kind: string; capacity: number | null };

const amount = (n: number, unit: string | undefined) =>
  !unit ? `${n}` : `${n}${unit === '°C' || unit === '%' ? '' : ' '}${unit}`;

/** Where a reading crosses one rule, and the line it crossed in words: "limit 60 km/h". */
function crossings(rule: PlaybookTrigger, r: Reading, places: Record<string, Place>) {
  const unit = observationDefinition(r.key)?.unit;
  const fits = (slug: string | null) => !rule.zoneKinds || (!!slug && rule.zoneKinds.includes(places[slug]?.kind));
  type Crossing = { zoneSlug: string | null; value: ReadingValue; line: string };
  if ('overCapacity' in rule) {
    const entries = (r.value as { entries?: { zoneSlug: string; count: number }[] } | null)?.entries ?? [];
    return entries.flatMap(({ zoneSlug, count }): Crossing[] => {
      const capacity = places[zoneSlug]?.capacity;
      return fits(zoneSlug) && capacity != null && count > capacity
        ? [{ zoneSlug, value: count, line: `capacity ${amount(capacity, unit)}` }] : [];
    });
  }
  const v = r.value;
  const crossed = (line: string): Crossing[] => [{ zoneSlug: r.zoneSlug, value: v as ReadingValue, line }];
  if (!fits(r.zoneSlug)) return [];
  if ('is' in rule) return (typeof v === 'string' || typeof v === 'boolean') && rule.is.includes(v) ? crossed('') : [];
  if (typeof v !== 'number') return [];
  if ('above' in rule) return v > rule.above ? crossed(`limit ${amount(rule.above, unit)}`) : [];
  if ('atLeast' in rule) return v >= rule.atLeast ? crossed(`limit ${amount(rule.atLeast, unit)}`) : [];
  return v < rule.below ? crossed(`under ${amount(rule.below, unit)}`) : [];
}

/** T3: one trigger per playbook and zone whose line this reading crosses. None when it's stale. */
export function readingTriggers(r: Reading, places: Record<string, Place>, now = Date.now()): Trigger[] {
  if (now - r.observedAt > STALE_MS) return [];
  const out = new Map<string, Trigger>();
  for (const book of FESTIVAL_PLAYBOOKS) {
    if (!isPlaybook(book.slug)) continue;
    for (const rule of book.triggers.filter((rule) => rule.key === r.key)) {
      for (const { zoneSlug, value, line } of crossings(rule, r, places)) {
        const id = `${book.slug}|${zoneSlug ?? ''}`;
        if (out.has(id)) continue;
        out.set(id, {
          playbook: book.slug,
          zoneSlug,
          causes: [{ kind: 'reading', readingId: r.id, key: r.key, zoneSlug, value, line, source: r.source,
            at: r.observedAt }],
          at: r.observedAt,
          strong: true,
          urgent: false,
        });
      }
    }
  }
  return [...out.values()];
}

/** T3: a new reading. The runs it started. */
export async function onReading(r: Reading, places: Record<string, Place>, withPlans?: WithPlans, now = Date.now()) {
  const runs: string[] = [];
  for (const t of readingTriggers(r, places, now)) {
    const runId = await fire(t, withPlans);
    if (runId) runs.push(runId);
  }
  return runs;
}

/** T2: this many reports in one zone within PILE_UP_MS add up. */
export const PILE_UP = 3;
export const PILE_UP_MS = 10 * 60_000;

/** A report in the window, with its summary for the model. */
export type Recent = ReportCause & { summary: string };

/** The database side of T2 (an in-memory fake in tests). */
export type Checks = {
  /** The zone's reports from `since` to `until`, oldest first. Not a plan's own tasks. */
  reports(zoneSlug: string, since: number, until: number): Promise<Recent[]>;
  /** A plan is being drafted, waiting for Mo or running in this zone, whatever its playbook. */
  planned(zoneSlug: string): Promise<boolean>;
  /** Take the zone's one check for the window from `since`: its id, or null when one already asked. */
  claim(zoneSlug: string, since: number, at: number, taskIds: string[]): Promise<string | null>;
  /** What the model said, for the record. */
  answered(checkId: string, playbook: PlaybookSlug | null): Promise<void>;
};
/** The playbook the reports add up to, or null. Throws when the model can't say. */
export type Ask = (zoneSlug: string, reports: Recent[]) => Promise<PlaybookSlug | null>;

/** T2: the run it started, else null. A model that fails or runs late means no trigger. */
export async function onPileUp(task: Task, checks: Checks = checksInDatabase, ask: Ask = askModel,
  withPlans?: WithPlans): Promise<string | null> {
  const zone = task.zoneSlug;
  if (!zone || task.mobilizationId) return null;
  const since = task.createdAt - PILE_UP_MS;
  const reports = await checks.reports(zone, since, task.createdAt);
  if (reports.length < PILE_UP || (await checks.planned(zone))) return null;
  const checkId = await checks.claim(zone, since, task.createdAt, reports.map((r) => r.taskId));
  if (!checkId) return null;
  const playbook = await ask(zone, reports).catch((e) => {
    console.warn(`reports at ${zone}: no answer from the model (${(e as Error).message})`);
    return null;
  });
  await checks.answered(checkId, playbook);
  if (!playbook) return null;
  const causes = reports.map(({ summary: _, ...cause }): MobilizationCause => cause);
  return fire({ playbook, zoneSlug: zone, causes, at: task.createdAt, strong: true, urgent: false }, withPlans);
}

const ASK_MS = 8_000;
const Answer = z.object({ playbook: z.enum([...PLAYBOOK_SLUGS, 'none']) });
const ASK_SYSTEM = `Several reports came in from one place at a music festival within a few minutes.
Say whether, together, they are one of these emergencies, which need several teams at once:
${FESTIVAL_PLAYBOOKS.map((book) => `${book.slug}: ${book.appliesWhen}`).join('\n')}
none: separate everyday incidents that one or two volunteers can handle, or too unclear to say.`;

async function askModel(zoneSlug: string, reports: Recent[]): Promise<PlaybookSlug | null> {
  const prompt = [`Place: ${zoneSlug}`, ...reports.map((r) => `- ${r.priority}: ${r.title}. ${r.summary}`)].join('\n');
  const { playbook } = await generate({ system: ASK_SYSTEM, prompt, schema: Answer },
    { signal: AbortSignal.timeout(ASK_MS) });
  return playbook === 'none' ? null : playbook;
}

/**
 * After a commit: reports it just filed (created at the batch's own `now`). One that names a playbook goes to T1/T4;
 * then every one with a place counts toward T2.
 */
export function planNewReports(b: Batch) {
  const fresh = Object.values(b.tasks).filter((t) => t.createdAt === b.now && !t.mobilizationId);
  if (!fresh.length) return;
  const filedBy = (t: Task) => b.events.find((e) => e.taskId === t.id && e.kind === 'created')?.actor.id;
  setTimeout(async () => {
    for (const t of fresh) {
      const by = filedBy(t);
      await onReport(t, !!by && b.volunteers[by]?.role === 'coordinator')
        .then(() => onPileUp(t))
        .catch((e) => console.error(`trigger for ${t.id} failed`, e));
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
        const cause = tx.json(t.causes as Parameters<typeof tx.json>[0]);
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
            causes: tx.json(t.causes as Parameters<typeof tx.json>[0]),
          })} returning id`;
        return run.id;
      },
    });
  });
  return out as T;
}

const checksInDatabase: Checks = {
  async reports(zone, since, until) {
    const rows = await sql()<(Omit<Recent, 'at' | 'kind'> & { at: string })[]>`
      select t.id as "taskId", t.title, t.summary, t.priority, z.slug as "zoneSlug",
        extract(epoch from t.created_at) * 1000 as at
      from tasks t join zones z on z.id = t.zone_id
      where z.slug = ${zone} and t.mobilization_id is null
        and t.created_at >= ${new Date(since).toISOString()}::timestamptz
        and t.created_at <= ${new Date(until).toISOString()}::timestamptz
      order by t.created_at, t.id`;
    return rows.map((r) => ({ ...r, kind: 'report', at: Number(r.at) }));
  },
  async planned(zone) {
    const [row] = await sql()<{ planned: boolean }[]>`select
      exists(select 1 from mobilization_runs where zone_slug = ${zone} and status = 'running')
      or exists(select 1 from mobilizations m join zones z on z.id = m.zone_id
        where z.slug = ${zone} and m.status in ('proposed', 'active')) as planned`;
    return row.planned;
  },
  // One check per zone at a time, so two reports at once can't both ask.
  claim: (zone, since, at, taskIds) => sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`moloop:pile-up:${zone}`}))`;
    const [asked] = await tx`select 1 from trigger_checks
      where zone_slug = ${zone} and checked_at >= ${new Date(since).toISOString()}::timestamptz`;
    if (asked) return null;
    const [check] = await tx<{ id: string }[]>`insert into trigger_checks (zone_slug, task_ids, checked_at)
      values (${zone}, ${taskIds}::uuid[], ${new Date(at).toISOString()}::timestamptz) returning id`;
    return check.id;
  }) as Promise<string | null>,
  async answered(checkId, playbook) {
    await sql()`update trigger_checks set playbook = ${playbook} where id = ${checkId}`;
  },
};


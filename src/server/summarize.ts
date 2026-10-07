import { z } from 'zod';

import { toTaskEvent, type Row } from '@/data/supabase/rows';
import { TEAMS } from '@/data/teams';
import { checkSummary, fallbackSummary, MAX_POINTS, type Summary, type SummaryScope } from '@/lib/summary';
import type { Task, TaskEvent } from '@/lib/schema';
import { generate } from './models';
import { summaryCache } from './summary-cache';
import { read, sql } from './world';

/** How far back "this shift" reaches. */
const SHIFT_MS = 24 * 60 * 60 * 1000;
/** The shift summary is made again at most this often, however busy it gets. */
const SHIFT_GAP_MS = 60_000;
/** Enough of the shift for the model to see what matters, without sending the whole day. */
const MAX_TASKS = 40;
const MAX_EVENTS_PER_TASK = 12;

const cache = summaryCache<Summary>({ now: Date.now });

const Output = z.object({
  headline: z.string().max(160),
  points: z.array(z.object({
    text: z.string().max(200),
    taskId: z.string().nullish(),
    teamSlug: z.string().nullish(),
  })).max(6),
});

const SYSTEM = `You brief Mo, who runs a music festival's volunteer crew, from the task log below.
Write one headline (under 90 characters) and at most ${MAX_POINTS} short points, in plain English, facts only.
Say what happened, where things stand now, and what is still open. Lead with what needs Mo: anyone who asked for help,
P1s, tasks nobody has taken, a team with nobody free. Use names, places and minutes from the log; never invent any.
Link a point to the task (taskId) or team (teamSlug) it is about, using only ids from the log.
For a single task: what happened, where it stands, what's still open, e.g. "Priya reached him in 4 min; he's conscious, medics on the way. Waiting on handover."`;

type Shift = { tasks: Record<string, Task>; events: TaskEvent[]; names: Record<string, string>; zones: Record<string, string> };

/**
 * A short summary of the shift or of one task, for Mo. Made by the model from the server's own read of the world
 * (the client never sends the content), kept until something new happens, and checked before it's returned. If the
 * model is down or slow it fails closed to plain counts, marked `ai: false`.
 */
export async function summarize(scope: SummaryScope): Promise<Summary> {
  const shift = await loadShift(scope);
  const events = scope.scope === 'task' ? shift.events.filter((e) => e.taskId === scope.taskId) : shift.events;
  const version = events.reduce<TaskEvent | undefined>((a, e) => (!a || e.at >= a.at ? e : a), undefined)?.id ?? 'none';
  const key = scope.scope === 'shift' ? 'shift' : `task:${scope.taskId}`;
  try {
    return await cache.get(key, version, { minGapMs: scope.scope === 'shift' ? SHIFT_GAP_MS : 0 }, async () => {
      const raw = await generate(
        { system: SYSTEM, prompt: describe(shift, scope), schema: Output },
        { signal: AbortSignal.timeout(Number(process.env.AI_SUMMARY_MS ?? 8_000)) },
      );
      const checked = checkSummary({
        headline: raw.headline,
        points: raw.points.map((p) => ({ text: p.text, taskId: p.taskId ?? undefined, teamSlug: p.teamSlug ?? undefined })),
      }, shift);
      if (!checked) throw new Error('the model had nothing to say');
      return { ...checked, ai: true, at: Date.now() };
    });
  } catch (e) {
    console.warn(`summarize ${key} fell back to counts: ${(e as Error).message}`);
    return { ...fallbackSummary(shift, scope), ai: false, at: Date.now() };
  }
}

/** The shift's tasks (finished ones too) and their events, read straight from the database. */
async function loadShift(scope: SummaryScope): Promise<Shift> {
  const q = sql();
  const since = new Date(Date.now() - SHIFT_MS);
  const ids = (await q<{ id: string }[]>`select id from tasks where created_at > ${since} order by created_at desc limit ${MAX_TASKS}`)
    .map((r) => r.id);
  if (scope.scope === 'task' && !ids.includes(scope.taskId)) ids.push(scope.taskId);
  const [{ world }, rows, zones] = await Promise.all([
    read({ taskIds: ids }, (l) => l),
    q<Row<'task_events'>[]>`select * from task_events where task_id = any(${ids}::uuid[]) order by created_at`,
    q<{ slug: string; name: string }[]>`select slug, name from zones`,
  ]);
  const names = Object.fromEntries(Object.values(world.volunteers).map((v) => [v.id, v.name]));
  const wanted = new Set(ids);
  return {
    tasks: Object.fromEntries(Object.entries(world.tasks).filter(([id]) => wanted.has(id))),
    events: rows.map((r) => toTaskEvent(r, r.actor_id ? names[r.actor_id] : undefined)),
    names,
    zones: Object.fromEntries(zones.map((z) => [z.slug, z.name])),
  };
}

const clock = (at: number) => new Date(at).toISOString().slice(11, 16);
const TEAM_NAME: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [t.slug, t.name]));

/** The log as the model reads it: one line per task, then its events, newest tasks first. */
function describe(s: Shift, scope: SummaryScope): string {
  const tasks = Object.values(s.tasks)
    .filter((t) => scope.scope === 'shift' || t.id === scope.taskId)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const lines = [`Now: ${clock(Date.now())} UTC.`, `Teams: ${Object.entries(TEAM_NAME).map(([slug, name]) => `${slug} = ${name}`).join('; ')}.`, ''];
  for (const t of tasks) {
    const who = t.assigneeId ? s.names[t.assigneeId] ?? 'someone' : 'nobody';
    const where = t.zoneSlug ? s.zones[t.zoneSlug] ?? t.zoneSlug : 'no zone';
    lines.push(`Task ${t.id} | ${t.priority} | team ${t.teamSlug ?? 'none'} | ${where} | ${t.status} | on it: ${who} | reported ${clock(t.createdAt)} | "${t.title}"`);
    for (const e of s.events.filter((x) => x.taskId === t.id).slice(-MAX_EVENTS_PER_TASK)) {
      lines.push(`  ${clock(e.at)} ${e.text}${e.note ? ` ("${e.note}")` : ''}${e.actor.name ? ` (${e.actor.name})` : ''}`);
    }
  }
  return lines.join('\n');
}

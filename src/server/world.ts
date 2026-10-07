import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  PROPOSAL_ACTION_SELECT, PROPOSAL_CANDIDATE_SELECT, refsFrom, toGuestRequest, toPosition, toProposal, toReporter, toTask, toVolunteer,
  type ProfileRow, type ProposalActionRow, type ProposalCandidateRow, type Row,
} from '@/data/supabase/rows';
import { Batch, type World } from '@/lib/batch';
import { PRESENCE } from '@/lib/presence';
import type { RosteredShift } from '@/lib/schema';
import { currentShift } from '@/lib/shifts';
import type { Run } from './models/interpreter';
import type { Database } from '@/lib/database.types';
import {
  assignmentStatus, deliveryRow, eventRow, idsFrom, messageRow, peopleOn, proposalRow, reportRow, requestRow, statusFromDuty, taskRow,
  type Ids,
} from './rows';

/**
 * The shared world in Postgres, for commands and the scheduler. Every write is one transaction:
 *
 *   lock → load the world → run a shared command (src/lib/commands.ts) on a Batch → write what it changed
 *
 * The lock is one transaction-scoped advisory lock for the whole world, not per task: commands read across
 * tasks (is this volunteer busy, which queued task comes next, who's the top free pick), so two commands on
 * different tasks can still race. One lock serialises them, which a festival's few writes a second can afford.
 * A tick that overlaps a command waits for it, then sees what it wrote, so a silent task nudges once.
 *
 * Rows are read with the phones' own mappers (src/data/supabase/rows.ts) and written with ./rows.ts.
 */

let client: Sql | undefined;

/**
 * Direct Postgres (DATABASE_URL), for transactions supabase-js can't do. Timestamps come back as the
 * strings supabase-js would give, so the shared mappers read them. prepare: false so a pooler works too.
 */
export function sql(): Sql {
  client ??= postgres(process.env.DATABASE_URL!, {
    max: 10, prepare: false, idle_timeout: 20, onnotice: () => {},
    types: {
      timestamptz: {
        to: 1184, from: [1082, 1114, 1184],
        serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)),
        parse: (x: string) => x,
      },
    },
  });
  return client;
}

/**
 * What a command needs beyond the live world (active, open and queued tasks, pending proposals, everyone, shifts
 * around now). `availability`: when people said they're free, for the scheduler's no-show cover.
 */
export type Load = { taskIds?: string[]; requestIds?: string[]; proposalIds?: string[]; availability?: boolean };

export type Loaded = {
  world: World;
  ids: Ids;
  /** guest_requests.guest_id, for "only your own request". */
  requestOwner: Record<string, string>;
};

/**
 * Where new rows come from: the festival-goer behind a new request, the volunteer behind a new report, the voice
 * clips it was said in (storage paths in the `voice` bucket), and the model run that decided it (a triage_runs row,
 * tied to the new task's report, to the report of the open task it joined (`taskId`), or to the request if no task
 * came of it). `before`: runs that led up to `run` on a task it joined (the picker's qualified call), stored beside it.
 */
export type Owners = {
  guestId?: string; reporterId?: string; clips?: string[]; run?: Run & { requestId?: string; taskId?: string }; before?: Run[];
};

type Q = Sql | TransactionSql;
type Enums = Database['public']['Enums'];

type VolunteerRow = ProfileRow & { skills: string[]; phone: string | null; bio: string | null };
type ShiftRow = {
  id: string; volunteer_id: string; status: Enums['shift_assignment_status']; reminded_at: string | null;
  starts_at: string; ends_at: string; team_id: string; requires: string[];
};
type TaskRow = Row<'tasks'> & {
  reporter_kind: Enums['reporter_kind']; raw_text: string | null; detected_language: string | null; speaker_needed: string | null; first_aid_needed: boolean | null; text_en: string | null;
  reporter_name: string | null;
};

const cols = (select: string) => select.split(',').map((c) => c.trim());

export async function loadWorld(q: Q, spec: Load = {}): Promise<Loaded> {
  const [teams, zones, volunteers, presence, shiftRows, windows] = await Promise.all([
    q<{ id: string; slug: string; name: string }[]>`select id, slug, name from teams`,
    q<{ id: string; slug: string }[]>`select id, slug from zones`,
    q<VolunteerRow[]>`
      select p.id, p.full_name, p.role, p.team_id, p.status, p.languages, p.last_known_zone, pp.phone, pp.bio,
        coalesce(array_agg(s.slug order by s.slug) filter (where s.slug is not null), '{}') as skills
      from profiles p
      left join profile_private pp on pp.id = p.id
      -- A lapsed certificate doesn't count: nobody is picked for a skill they no longer hold.
      left join volunteer_skills vs on vs.volunteer_id = p.id and (vs.expires_on is null or vs.expires_on >= current_date)
      left join skills s on s.id = vs.skill_id
      group by p.id, pp.phone, pp.bio
      order by p.created_at, p.id`,
    // Live GPS for walking distances. Anything older says nothing (see lib/presence.ts).
    q<Row<'presence'>[]>`select * from presence where at > now() - make_interval(secs => ${PRESENCE.goneMs / 1000})`,
    // Shifts starting within the hour or not long over (someone may still be finishing a task), not yet done with.
    q<ShiftRow[]>`
      select sa.id, sa.volunteer_id, sa.status, sa.reminded_at, s.starts_at, s.ends_at, s.team_id,
        coalesce((select array_agg(k.slug) from skills k where k.id = any(s.required_skill_ids)), '{}') as requires
      from shift_assignments sa join shifts s on s.id = sa.shift_id
      where s.starts_at < now() + interval '1 hour' and s.ends_at > now() - interval '12 hours'
        and sa.status in ('assigned', 'confirmed', 'checked_in', 'no_show')`,
    spec.availability
      ? q<{ volunteer_id: string; starts_at: string; ends_at: string }[]>`
        select volunteer_id, starts_at, ends_at from availability_windows where ends_at > now() and starts_at < now() + interval '1 day'`
      : Promise.resolve([]),
  ]);
  const refs = refsFrom(teams, zones);

  const requestRows = await requestsById(q, spec.requestIds ?? []);
  const actions = await q<ProposalActionRow[]>`
    select ${q(cols(PROPOSAL_ACTION_SELECT))} from agent_actions
    where type = 'assign_volunteer' and task_id is not null and (status = 'pending' or id = any(${spec.proposalIds ?? []}::uuid[]))
    order by created_at, id`;
  const candidates = actions.length ? await q<ProposalCandidateRow[]>`
    select ${q(cols(PROPOSAL_CANDIDATE_SELECT))} from task_assignments
    where task_id = any(${actions.map((a) => a.task_id!)}::uuid[]) and status = 'proposed'` : [];

  const named = new Set(spec.proposalIds ?? []);
  const explicit = [
    ...(spec.taskIds ?? []),
    ...requestRows.flatMap((r) => (r.task_id ? [r.task_id] : [])),
    ...actions.filter((a) => named.has(a.id)).map((a) => a.task_id!),
  ];
  const taskRows = await q<TaskRow[]>`
    select t.*, r.reporter_kind, r.raw_text, r.detected_language, r.speaker_needed, r.first_aid_needed, r.text_en, rp.full_name as reporter_name
    from tasks t
    join reports r on r.id = t.report_id
    left join profiles rp on rp.id = r.reporter_id
    where t.status not in ('resolved', 'cancelled') or t.id = any(${explicit}::uuid[])
    order by t.created_at, t.id`;
  // The request behind a task a command names (guestReply writes to its thread).
  const have = new Set(requestRows.map((r) => r.id));
  const wanted = new Set(explicit);
  const more = taskRows.filter((t) => wanted.has(t.id) && t.request_id && !have.has(t.request_id)).map((t) => t.request_id!);
  if (more.length) requestRows.push(...(await requestsById(q, more)));

  const tasks = taskRows.map((t) => toTask(t, refs, toReporter({
    reporter_kind: t.reporter_kind, raw_text: t.raw_text, detected_language: t.detected_language, speaker_needed: t.speaker_needed, first_aid_needed: t.first_aid_needed, text_en: t.text_en,
    reporter: t.reporter_name ? { full_name: t.reporter_name } : null,
  })));
  const shifts = byId(shiftRows.map((r): RosteredShift => ({
    id: r.id, volunteerId: r.volunteer_id, teamSlug: (refs.teams.get(r.team_id) ?? null) as RosteredShift['teamSlug'],
    startsAt: Date.parse(r.starts_at), endsAt: Date.parse(r.ends_at), requires: r.requires,
    status: r.status === 'checked_in' || r.status === 'no_show' ? r.status : 'assigned', remindedAt: r.reminded_at ? Date.parse(r.reminded_at) : null,
  })));
  const availability: Record<string, { from: number; to: number }[]> = {};
  for (const w of windows) (availability[w.volunteer_id] ??= []).push({ from: Date.parse(w.starts_at), to: Date.parse(w.ends_at) });
  const now = Date.now();
  return {
    world: {
      volunteers: byId(volunteers.map((v) => ({
        ...toVolunteer(v, refs, { skills: v.skills, phone: v.phone }), bio: v.bio, shiftEndsAt: currentShift(shifts, v.id, now)?.endsAt ?? null,
      }))),
      shifts,
      availability,
      tasks: byId(tasks),
      // Only pending ones drive anything; a decided one is loaded to say it's already decided.
      proposals: byId(actions.map((a) => toProposal(a, candidates))),
      requests: byId(requestRows.map((r) => toGuestRequest(r, refs))),
      teams: Object.fromEntries(teams.map((t) => [t.slug, { name: t.name }])),
      positions: Object.fromEntries(presence.map((r) => [r.person_id, toPosition(r)])),
    },
    ids: idsFrom(refs),
    requestOwner: Object.fromEntries(requestRows.map((r) => [r.id, r.guest_id])),
  };
}

const requestsById = (q: Q, ids: string[]) =>
  (ids.length ? q<Row<'guest_requests'>[]>`select * from guest_requests where id = any(${ids}::uuid[])` : Promise.resolve([] as Row<'guest_requests'>[]));

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x])) as Record<string, T>;

/**
 * A batch's events (and messages) share one ms. The i-th gets i µs on top, so ordering by created_at keeps the
 * order the command wrote them in ("moved it to Kai" before "Assigned to Kai"). Reads truncate back to the ms.
 */
const inOrder = (at: number, i: number) => new Date(at).toISOString().replace('Z', `${String(i % 1000).padStart(3, '0')}Z`);

/** Write what a Batch changed. New tasks get a `reports` row; proposals and people on tasks get task_assignments. */
async function save(tx: TransactionSql, { world, ids }: Loaded, b: Batch, owners: Owners) {
  const d = b.dirty;
  const json = (v: unknown) => (v == null ? null : tx.json(v as Parameters<typeof tx.json>[0]));

  // New requests first, without a task: tasks point at requests and requests at tasks.
  for (const id of d.requests) {
    if (id in world.requests) continue;
    if (!owners.guestId) throw new Error(`request ${id} has no festival-goer`);
    const r = b.requests[id];
    await tx`insert into guest_requests ${tx({
      id, guest_id: owners.guestId, ...requestRow(r, ids), task_id: null, thread: json(r.thread), created_at: new Date(r.createdAt),
      voice_clips: owners.clips ?? [],
    })}`;
  }

  let runWritten = false;
  for (const id of d.tasks) {
    const t = b.tasks[id];
    const row = { ...taskRow(t, ids), escalation: json(t.escalation) };
    if (id in world.tasks) {
      await tx`update tasks set ${tx(row)} where id = ${id}`;
      continue;
    }
    const report = { ...reportRow(t, ids, t.reporter.kind === 'festivalgoer' ? null : owners.reporterId ?? null), voice_clips: owners.clips ?? [] };
    await tx`insert into reports ${tx(report)}`;
    // A request's task: the report is what the festival-goer said, clips included.
    if (t.requestId) await tx`update reports set voice_clips = r.voice_clips from guest_requests r where r.id = ${t.requestId} and reports.id = ${report.id}`;
    const triageRunId = owners.run && !runWritten ? await insertRun(tx, owners.run, report.id) : null;
    runWritten ||= !!owners.run;
    await tx`insert into tasks ${tx({ id, report_id: report.id, triage_run_id: triageRunId, created_at: new Date(t.createdAt), ...row })}`;
    if (t.requestId) await tx`update guest_requests set report_id = coalesce(report_id, ${report.id}) where id = ${t.requestId}`;
  }

  // A run that made no task hangs off the task it joined (re-triage), or off the request (the AI answered).
  if (owners.run?.taskId && !runWritten) {
    const [joined] = await tx<{ report_id: string }[]>`select report_id from tasks where id = ${owners.run.taskId}`;
    for (const r of [...(owners.before ?? []), owners.run]) await insertRun(tx, r, joined?.report_id ?? null);
  } else if (owners.run?.requestId && !runWritten) await insertRun(tx, owners.run, null);

  for (const id of d.requests) {
    const r = b.requests[id];
    await tx`update guest_requests set ${tx({ ...requestRow(r, ids), thread: json(r.thread) })} where id = ${id}`;
  }

  for (const id of d.proposals) {
    const p = b.proposals[id];
    const row = { ...proposalRow(p), payload: json(proposalRow(p).payload) };
    const before = world.proposals[id];
    const same = before && before.candidates.map((c) => `${c.volunteerId} ${c.rationale}`).join() === p.candidates.map((c) => `${c.volunteerId} ${c.rationale}`).join();
    if (before) await tx`update agent_actions set ${tx(row)} where id = ${id}`;
    else await tx`insert into agent_actions ${tx({ id, ...row })}`;
    // New, or re-ranked by the picker (who's on it can change, and the why with it): the candidate rows follow.
    if (!same && p.status === 'pending') {
      if (before) await tx`delete from task_assignments where task_id = ${p.taskId} and status = 'proposed'`;
      if (p.candidates.length) {
        await tx`insert into task_assignments ${tx(p.candidates.map((c) => ({
          task_id: p.taskId, volunteer_id: c.volunteerId, rationale: c.rationale, distance_m: c.distanceM,
        })))}`;
      }
    }
    if (p.status !== 'pending') {
      await tx`
        update task_assignments
        set status = (case when volunteer_id = ${p.volunteerId}::uuid then 'approved' else 'rejected' end)::task_assignment_status,
          approved_by = ${p.decidedById}::uuid
        where task_id = ${p.taskId} and status = 'proposed'`;
    }
  }

  // After proposals, so the pick's approved row is the one that carries on.
  for (const id of d.tasks) {
    const before = peopleOn(world.tasks[id]);
    const after = peopleOn(b.tasks[id]);
    for (const v of after) {
      const status = assignmentStatus(b.tasks[id], v);
      if (status) await follow(tx, id, v, status);
    }
    for (const v of before) if (!after.includes(v)) await follow(tx, id, v, 'reassigned');
  }

  for (const id of d.shifts) {
    const s = b.shifts[id];
    const checkedIn = s.status === 'checked_in' && world.shifts?.[id]?.status !== 'checked_in' ? new Date(b.now) : null;
    await tx`
      update shift_assignments set status = ${s.status}, reminded_at = ${s.remindedAt ? new Date(s.remindedAt) : null},
        checked_in_at = coalesce(${checkedIn}, checked_in_at)
      where id = ${id}`;
  }

  for (const id of d.volunteers) {
    const v = b.volunteers[id];
    const zone = v.zoneSlug ? ids.zones.get(v.zoneSlug) ?? null : null;
    await tx`update profiles set status = ${statusFromDuty(v.duty)}, last_known_zone = ${zone} where id = ${id}`;
  }

  if (b.events.length) {
    await tx`insert into task_events ${tx(b.events.map((e, i) => {
      const r = eventRow(e);
      return { ...r, data: json(r.data), created_at: inOrder(e.at, i) };
    }))}`;
  }
  if (b.messages.length) {
    await tx`insert into messages ${tx(b.messages.map((m, i) => ({ ...messageRow(m, b.senders[m.id] ?? null), created_at: inOrder(m.at, i) })))}`;
    await tx`insert into message_deliveries ${tx(b.messages.map(deliveryRow))}`;
  }
}

async function insertRun(tx: TransactionSql, run: NonNullable<Owners['run']>, reportId: string | null) {
  const j = (v: unknown) => (v == null ? null : tx.json(v as Parameters<typeof tx.json>[0]));
  const [row] = await tx<{ id: string }[]>`
    insert into triage_runs ${tx({
      report_id: reportId, request_id: run.requestId ?? null, route: run.route, route_reason: run.reason, router_conf: run.confidence,
      team_result: j(run.team), priority_result: j(run.priority), rewrite_result: j(run.rewrite), models: j(run.models),
      latency_ms: run.latencyMs, error: run.error,
    })} returning id`;
  return row.id;
}

/**
 * Keep someone's task_assignments row in step with where they stand on a task. One row per person per task,
 * reused if they come back; candidate rows (proposed, rejected) are the proposal's, not theirs. An approved
 * pick stays approved until they accept.
 */
async function follow(tx: TransactionSql, taskId: string, volunteerId: string, status: Enums['task_assignment_status']) {
  const [row] = await tx<{ id: string; status: Enums['task_assignment_status'] }[]>`
    select id, status from task_assignments
    where task_id = ${taskId} and volunteer_id = ${volunteerId} and status not in ('proposed', 'rejected')
    order by created_at desc limit 1`;
  if (!row) {
    await tx`insert into task_assignments ${tx({ task_id: taskId, volunteer_id: volunteerId, status })}`;
  } else if (row.status !== status && !(row.status === 'approved' && status === 'notified')) {
    await tx`update task_assignments set status = ${status} where id = ${row.id}`;
  }
}

type Committed = (b: Batch) => void;
const committed: Committed[] = [];

/** Run `fn` after every transaction that commits, with what it wrote (the server speaks new briefs). */
export function afterCommit(fn: Committed) {
  committed.push(fn);
}

/** Run one shared command atomically against the shared world. Throws roll everything back. */
export async function transact<T>(spec: Load, run: (b: Batch, loaded: Loaded) => T, owners: Owners = {}): Promise<T> {
  let batch: Batch | undefined;
  const result = await sql().begin(async (tx) => {
    await tx`set local lock_timeout = '10s'`;
    await tx`set local statement_timeout = '10s'`;
    await tx`select pg_advisory_xact_lock(hashtext('moloop:world'))`;
    const loaded = await loadWorld(tx, spec);
    // The clock starts once we hold the lock, so the world we read is never newer than `now`.
    const b = new Batch(loaded.world, { now: Date.now(), id: () => crypto.randomUUID() });
    const out = run(b, loaded);
    await save(tx, loaded, b, owners);
    batch = b;
    return [out] as const;
  });
  for (const fn of committed) {
    try {
      fn(batch!);
    } catch (e) {
      console.error('afterCommit failed', e);
    }
  }
  return result[0] as T;
}

/** Read the world without locking or writing (interpret). */
export async function read<T>(spec: Load, run: (loaded: Loaded) => T): Promise<T> {
  return run(await loadWorld(sql(), spec));
}

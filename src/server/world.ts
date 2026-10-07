import postgres, { type Sql, type TransactionSql } from 'postgres';

import { Batch, type World } from '@/lib/batch';
import {
  deliveryRow, eventRow, messageRow, proposalFromRow, proposalRow, reportRow, requestFromRow, requestRow, statusOf, taskFromRow, taskRow,
  ts, volunteerFromRow, type ProposalRow, type Refs, type RequestRow, type TaskRow, type VolunteerRow,
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
 */

let client: Sql | undefined;

/** Direct Postgres (DATABASE_URL), for transactions supabase-js can't do. prepare: false so a transaction-mode pooler works too. */
export function sql(): Sql {
  client ??= postgres(process.env.DATABASE_URL!, { max: 10, prepare: false, idle_timeout: 20, onnotice: () => {} });
  return client;
}

/** What a command needs beyond the live world (active, open and queued tasks, pending proposals, everyone). */
export type Load = { taskIds?: string[]; requestIds?: string[]; proposalIds?: string[] };

export type Loaded = {
  world: World;
  refs: Refs;
  /** guest_requests.guest_id, for "only your own request". */
  requestOwner: Record<string, string>;
};

/** Who new rows belong to: the festival-goer behind a new request, the volunteer behind a new report. */
export type Owners = { guestId?: string; reporterId?: string };

type Q = Sql | TransactionSql;

export async function loadWorld(q: Q, spec: Load = {}): Promise<Loaded> {
  const [teams, zones, volunteers] = await Promise.all([
    q<{ id: string; slug: string; name: string }[]>`select id, slug, name from teams`,
    q<{ id: string; slug: string }[]>`select id, slug from zones`,
    q<VolunteerRow[]>`
      select p.id, p.full_name, p.role, t.slug as team_slug, z.slug as zone_slug, p.status, p.languages, pp.phone,
        coalesce(array_agg(s.slug order by s.slug) filter (where s.slug is not null), '{}') as skills
      from profiles p
      left join teams t on t.id = p.team_id
      left join zones z on z.id = p.last_known_zone
      left join profile_private pp on pp.id = p.id
      left join volunteer_skills vs on vs.volunteer_id = p.id
      left join skills s on s.id = vs.skill_id
      group by p.id, t.slug, z.slug, pp.phone
      order by p.created_at, p.id`,
  ]);
  const refs: Refs = {
    teamId: new Map(teams.map((t) => [t.slug, t.id])),
    teamSlug: new Map(teams.map((t) => [t.id, t.slug])),
    teamName: new Map(teams.map((t) => [t.slug, t.name])),
    zoneId: new Map(zones.map((z) => [z.slug, z.id])),
    zoneSlug: new Map(zones.map((z) => [z.id, z.slug])),
  };

  const requestRows = await requestsById(q, spec.requestIds ?? []);
  const proposalRows = await q<ProposalRow[]>`
    select id, task_id, payload, rationale, status, decided_by, decided_at, auto_assign_at, created_at
    from agent_actions
    where type = 'assign_volunteer' and task_id is not null and (status = 'pending' or id = any(${spec.proposalIds ?? []}::uuid[]))
    order by created_at, id`;
  const named = new Set(spec.proposalIds ?? []);
  const explicit = [
    ...(spec.taskIds ?? []),
    ...requestRows.flatMap((r) => (r.task_id ? [r.task_id] : [])),
    ...proposalRows.filter((p) => named.has(p.id)).map((p) => p.task_id),
  ];
  const taskRows = await q<TaskRow[]>`
    select t.id, t.title, t.summary, t.category, t.priority, tm.slug as team_slug, z.slug as zone_slug, t.location_hint, t.status,
      t.assignee_id, t.handled_by, t.created_at, t.assigned_at, t.eta_at, t.last_activity_at, t.nudge_count, t.last_nudge_at,
      t.lead_alerted_at, t.resolved_at, t.escalation, t.helper_ids, t.resolution, t.request_id,
      r.reporter_kind, r.raw_text, r.detected_language, rp.full_name as reporter_name
    from tasks t
    join reports r on r.id = t.report_id
    left join teams tm on tm.id = t.team_id
    left join zones z on z.id = t.zone_id
    left join profiles rp on rp.id = r.reporter_id
    where t.status not in ('resolved', 'cancelled') or t.id = any(${explicit}::uuid[])
    order by t.created_at, t.id`;
  // The request behind a task a command names (guestReply writes to its thread).
  const have = new Set(requestRows.map((r) => r.id));
  const wanted = new Set(explicit);
  const more = taskRows.filter((t) => wanted.has(t.id) && t.request_id && !have.has(t.request_id)).map((t) => t.request_id!);
  if (more.length) requestRows.push(...(await requestsById(q, more)));

  return {
    world: {
      volunteers: byId(volunteers.map(volunteerFromRow)),
      tasks: byId(taskRows.map(taskFromRow)),
      proposals: byId(proposalRows.map(proposalFromRow)),
      requests: byId(requestRows.map(requestFromRow)),
      teams: Object.fromEntries(teams.map((t) => [t.slug, { name: t.name }])),
    },
    refs,
    requestOwner: Object.fromEntries(requestRows.map((r) => [r.id, r.guest_id])),
  };
}

const requestsById = (q: Q, ids: string[]) => (ids.length ? q<RequestRow[]>`
  select r.id, r.guest_id, r.heard, z.slug as zone_slug, r.location_hint, r.stage, r.ai_answer, r.task_id, r.thread, r.reopened_at, r.created_at
  from guest_requests r left join zones z on z.id = r.zone_id
  where r.id = any(${ids}::uuid[])` : Promise.resolve([] as RequestRow[]));

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x])) as Record<string, T>;

/** Write what a Batch changed. New tasks get a `reports` row; proposals get their task_assignments. */
async function save(tx: TransactionSql, { world, refs }: Loaded, b: Batch, owners: Owners) {
  const d = b.dirty;
  const json = (v: unknown) => (v == null ? null : tx.json(v as Parameters<typeof tx.json>[0]));

  // New requests first, without a task: tasks point at requests and requests at tasks.
  for (const id of d.requests) {
    if (id in world.requests) continue;
    if (!owners.guestId) throw new Error(`request ${id} has no festival-goer`);
    const r = b.requests[id];
    await tx`insert into guest_requests ${tx({
      id, guest_id: owners.guestId, ...requestRow(r, refs), task_id: null, thread: json(r.thread), created_at: ts(r.createdAt),
    })}`;
  }

  for (const id of d.tasks) {
    const t = b.tasks[id];
    const row = { ...taskRow(t, refs), escalation: json(t.escalation) };
    if (id in world.tasks) {
      await tx`update tasks set ${tx(row)} where id = ${id}`;
      continue;
    }
    const report = reportRow(t, refs, t.reporter.kind === 'festivalgoer' ? null : owners.reporterId ?? null);
    await tx`insert into reports ${tx(report)}`;
    await tx`insert into tasks ${tx({ id, report_id: report.id, created_at: ts(t.createdAt), ...row })}`;
    if (t.requestId) await tx`update guest_requests set report_id = coalesce(report_id, ${report.id}) where id = ${t.requestId}`;
  }

  for (const id of d.requests) {
    const r = b.requests[id];
    await tx`update guest_requests set ${tx({ ...requestRow(r, refs), thread: json(r.thread) })} where id = ${id}`;
  }

  for (const id of d.proposals) {
    const p = b.proposals[id];
    const row = { ...proposalRow(p), payload: json(proposalRow(p).payload) };
    if (id in world.proposals) {
      await tx`update agent_actions set ${tx(row)} where id = ${id}`;
    } else {
      await tx`insert into agent_actions ${tx({ id, ...row })}`;
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

  for (const id of d.volunteers) {
    const v = b.volunteers[id];
    const zone = v.zoneSlug ? refs.zoneId.get(v.zoneSlug) ?? null : null;
    await tx`update profiles set status = ${statusOf(v.duty)}, last_known_zone = ${zone} where id = ${id}`;
  }

  if (b.events.length) {
    await tx`insert into task_events ${tx(b.events.map((e) => {
      const r = eventRow(e);
      return { ...r, data: json(r.data) };
    }))}`;
  }
  if (b.messages.length) {
    await tx`insert into messages ${tx(b.messages.map((m) => messageRow(m, b.senders[m.id] ?? null)))}`;
    await tx`insert into message_deliveries ${tx(b.messages.map(deliveryRow))}`;
  }
}

/** Run one shared command atomically against the shared world. Throws roll everything back. */
export async function transact<T>(spec: Load, run: (b: Batch, loaded: Loaded) => T, owners: Owners = {}): Promise<T> {
  const result = await sql().begin(async (tx) => {
    await tx`set local lock_timeout = '10s'`;
    await tx`set local statement_timeout = '10s'`;
    await tx`select pg_advisory_xact_lock(hashtext('moloop:world'))`;
    const loaded = await loadWorld(tx, spec);
    // The clock starts once we hold the lock, so the world we read is never newer than `now`.
    const b = new Batch(loaded.world, { now: Date.now(), id: () => crypto.randomUUID() });
    const out = run(b, loaded);
    await save(tx, loaded, b, owners);
    return [out] as const;
  });
  return result[0] as T;
}

/** Read the world without locking or writing (interpret). */
export async function read<T>(spec: Load, run: (loaded: Loaded) => T): Promise<T> {
  return run(await loadWorld(sql(), spec));
}

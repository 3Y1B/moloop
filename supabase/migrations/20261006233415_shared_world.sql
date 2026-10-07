-- Moloop migration 2: one shared world for the field test (docs/PLAN-LIVE.md, phase 1).
-- Adds what the domain types (src/lib/schema/domain.ts) have and the schema lacked, and replaces the
-- hackathon RLS with policies that match what each screen reads.
-- Rule: phones read straight from Supabase, every write goes through the server (service role).
-- Presence is the one exception: phones upsert their own row.

-- ───────────────────────────── enums ─────────────────────────────

create type guest_request_stage as enum ('understanding', 'answered', 'finding', 'coming', 'with_you', 'sorted', 'cancelled');
create type task_resolution as enum ('done', 'handed_over', 'cancelled');

-- ───────────────────────────── people ─────────────────────────────

-- A festival-goer can see who is coming to help them, so contact details move off profiles.
create table profile_private (
  id         uuid primary key references profiles on delete cascade,
  phone      text,
  push_token text
);
insert into profile_private (id, phone, push_token) select id, phone, push_token from profiles;
alter table profiles drop column phone, drop column push_token;

-- ───────────────────────────── festival-goers ─────────────────────────────

-- A festival-goer's question or report (GuestRequest). guest_id is their anonymous auth user.
create table guest_requests (
  id            uuid primary key default gen_random_uuid(),
  guest_id      uuid not null references auth.users on delete cascade,
  report_id     uuid references reports,
  heard         text not null,                             -- what they said, as understood
  zone_id       uuid references zones,
  location_hint text,
  stage         guest_request_stage not null default 'understanding', -- before a task exists; then derived from the task
  ai_answer     text,
  task_id       uuid,                                      -- fk below, once tasks.request_id exists
  thread        jsonb not null default '[]',               -- GuestThreadEntry[] (times in epoch ms)
  reopened_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on guest_requests (guest_id, created_at desc);
create index on guest_requests (task_id);

alter function touch_updated_at() set search_path = '';

create trigger guest_requests_touch before update on guest_requests
  for each row execute function touch_updated_at();

-- ───────────────────────────── tasks ─────────────────────────────

alter table tasks
  add column location_hint text,
  add column escalation    jsonb,                          -- Escalation | null (times in epoch ms)
  add column helper_ids    uuid[] not null default '{}',   -- backup sent by a lead
  add column resolution    task_resolution,                -- null while open
  add column request_id    uuid references guest_requests on delete set null;
create index on tasks using gin (helper_ids);
create index on tasks (request_id);
create index on tasks (report_id);

alter table guest_requests add constraint guest_requests_task_id_fkey
  foreign key (task_id) references tasks on delete set null;

-- Proposals are task_assignments(status = proposed), one per candidate, plus one pending
-- agent_actions(assign_volunteer). Nobody acting by auto_assign_at means the top pick gets it.
alter table agent_actions add column auto_assign_at timestamptz;

-- ───────────────────────────── messages ─────────────────────────────

alter table messages add column kind text not null default 'direct' check (kind in (
  'task', 'nudge', 'broadcast', 'direct', 'system', 'moved', 'closed', 'arrived', 'backup', 'escalation', 'guest_reply'
));
-- How it reached the volunteer: read aloud (idle) or a short ping (busy).
alter table message_deliveries add column delivery text check (delivery in ('spoken', 'ping'));
create index on message_deliveries (recipient_id);

-- ───────────────────────────── presence ─────────────────────────────

-- Live GPS, one row per person (crew and festival-goers). Upserted by the phone; `at` is server time.
create table presence (
  person_id uuid primary key default auth.uid() references auth.users on delete cascade,
  lat       double precision not null,
  lng       double precision not null,
  accuracy  real,                                          -- metres
  heading   real,                                          -- degrees from north
  at        timestamptz not null default now()
);

create function stamp_presence() returns trigger language plpgsql set search_path = '' as $$
begin new.at = now(); return new; end $$;
create trigger presence_stamp before insert or update on presence
  for each row execute function stamp_presence();

-- ───────────────────────────── realtime ─────────────────────────────

alter publication supabase_realtime add table guest_requests, presence, profiles, message_deliveries;

-- ───────────────────────────── access helpers ─────────────────────────────

-- Security definer so policies can ask "who am I" without recursing through profiles' own RLS.
-- Kept in `private`, which the Data API doesn't expose.
create schema if not exists private;
grant usage on schema private to authenticated;

create function private.is_crew() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()))
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('team_lead', 'coordinator', 'safety_lead', 'admin')
  )
$$;

-- Owner or helper on a task. Lets guest_requests check the task without tasks' RLS looping back.
create function private.works_on(task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = task and ((select auth.uid()) = t.assignee_id or (select auth.uid()) = any (t.helper_ids))
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ───────────────────────────── grants ─────────────────────────────

-- Explicit, so it holds whether or not the project auto-exposes new tables. anon gets nothing:
-- festival-goers use anonymous sign-in, which is the authenticated role.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on
  zones, teams, skills, profiles, profile_private, volunteer_skills, availability_windows, shifts,
  shift_assignments, reports, triage_runs, tasks, task_assignments, task_events, agent_actions,
  messages, message_deliveries, playbooks, guest_requests, presence
to authenticated;
grant insert, update on presence to authenticated;
grant all on all tables in schema public to service_role;

-- ───────────────────────────── RLS ─────────────────────────────

drop policy "staff read all profiles" on profiles;
drop policy "staff read reports" on reports;
drop policy "staff read tasks" on tasks;
drop policy "volunteer reads own task" on tasks;
drop policy "read own or staff assignments" on task_assignments;
drop policy "volunteer updates own assignment" on task_assignments;
drop policy "staff read events" on task_events;
drop policy "staff manage actions" on agent_actions;
drop policy "read own shifts" on shift_assignments;
drop policy "staff read triage runs" on triage_runs;
drop policy "read own deliveries" on message_deliveries;
drop policy "read relevant messages" on messages;
drop function public.is_staff();

alter table zones                enable row level security;
alter table teams                enable row level security;
alter table skills               enable row level security;
alter table profile_private      enable row level security;
alter table volunteer_skills     enable row level security;
alter table availability_windows enable row level security;
alter table shifts               enable row level security;
alter table playbooks            enable row level security;
alter table guest_requests       enable row level security;
alter table presence             enable row level security;

-- Reference data: anyone signed in, festival-goers included (zone picker, map).
create policy "signed in read zones"  on zones  for select to authenticated using (true);
create policy "signed in read teams"  on teams  for select to authenticated using (true);
create policy "signed in read skills" on skills for select to authenticated using (true);

-- Crew see each other (map, team, pickers). Festival-goers see only who is helping them.
create policy "crew, or a guest's helpers" on profiles for select to authenticated using (
  (select private.is_crew())
  or exists (select 1 from tasks t where t.assignee_id = profiles.id or profiles.id = any (t.helper_ids))
);
create policy "crew read contacts" on profile_private for select to authenticated using ((select private.is_crew()));
create policy "crew read skills held" on volunteer_skills for select to authenticated using ((select private.is_crew()));
create policy "crew read shifts" on shifts for select to authenticated using ((select private.is_crew()));
create policy "own or staff shift assignments" on shift_assignments for select to authenticated using (
  volunteer_id = (select auth.uid()) or (select private.is_staff())
);
create policy "own or staff availability" on availability_windows for select to authenticated using (
  volunteer_id = (select auth.uid()) or (select private.is_staff())
);
create policy "staff read playbooks" on playbooks for select to authenticated using ((select private.is_staff()));

-- Tasks: leads and Mo see everything; a volunteer sees what they own, help on, or were proposed for;
-- a festival-goer sees the task their request became.
create policy "staff, people on it, or the guest who asked" on tasks for select to authenticated using (
  (select private.is_staff())
  or assignee_id = (select auth.uid())
  or (select auth.uid()) = any (helper_ids)
  or exists (select 1 from task_assignments a where a.task_id = tasks.id and a.volunteer_id = (select auth.uid()))
  or exists (select 1 from guest_requests r where r.task_id = tasks.id and r.guest_id = (select auth.uid()))
);

-- The report behind any task you can see (reporter quote and language).
create policy "read reports behind visible tasks" on reports for select to authenticated using (
  (select private.is_staff()) or exists (select 1 from tasks t where t.report_id = reports.id)
);
create policy "staff read triage runs" on triage_runs for select to authenticated using ((select private.is_staff()));

create policy "own or staff assignments" on task_assignments for select to authenticated using (
  volunteer_id = (select auth.uid()) or (select private.is_staff())
);
create policy "crew read events on visible tasks" on task_events for select to authenticated using (
  (select private.is_crew()) and exists (select 1 from tasks t where t.id = task_events.task_id)
);
create policy "staff read actions" on agent_actions for select to authenticated using ((select private.is_staff()));

create policy "own or staff deliveries" on message_deliveries for select to authenticated using (
  recipient_id = (select auth.uid()) or (select private.is_staff())
);
create policy "staff or delivered messages" on messages for select to authenticated using (
  (select private.is_staff())
  or exists (select 1 from message_deliveries d where d.message_id = messages.id and d.recipient_id = (select auth.uid()))
);

-- A festival-goer's own requests; staff see all; the volunteer on the task sees its thread.
create policy "own, staff or helper requests" on guest_requests for select to authenticated using (
  guest_id = (select auth.uid())
  or (select private.is_staff())
  or (task_id is not null and private.works_on(task_id))
);

-- Presence: write your own row. Read: staff see everyone; crew see crew; a festival-goer sees who's
-- coming; a volunteer sees the festival-goer they're helping.
create policy "write own presence" on presence for insert to authenticated with check (person_id = (select auth.uid()));
create policy "update own presence" on presence for update to authenticated
  using (person_id = (select auth.uid())) with check (person_id = (select auth.uid()));
create policy "read relevant presence" on presence for select to authenticated using (
  person_id = (select auth.uid())
  or (select private.is_staff())
  or ((select private.is_crew()) and exists (select 1 from profiles p where p.id = presence.person_id))
  or exists (select 1 from tasks t where t.assignee_id = presence.person_id or presence.person_id = any (t.helper_ids))
  or exists (
    select 1 from guest_requests r
    where r.guest_id = presence.person_id and r.task_id is not null and private.works_on(r.task_id)
  )
);

-- Stable stage timetable. The simulation may override relative timing in its own snapshot only.
create table event_timetable (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references zones,
  act text not null check (length(trim(act)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expected_people integer check (expected_people >= 0),
  check (ends_at > starts_at),
  unique(stage_id, starts_at)
);
create index event_timetable_time on event_timetable(starts_at);

-- Published schedule fixtures, not generated incident/tasks or pre-canned mobilizations.
insert into event_timetable(stage_id, act, starts_at, ends_at, expected_people)
select z.id, e.act, e.starts_at, e.ends_at, e.expected_people
from (values
  ('lawn-stage','Opening set','2026-10-08T14:00:00+11:00'::timestamptz,'2026-10-08T15:00:00+11:00'::timestamptz,3000),
  ('river-stage','Afternoon set','2026-10-08T14:30:00+11:00'::timestamptz,'2026-10-08T15:30:00+11:00'::timestamptz,1800),
  ('lawn-stage','Evening headliner','2026-10-09T19:00:00+11:00'::timestamptz,'2026-10-09T20:15:00+11:00'::timestamptz,7500),
  ('river-stage','Evening support','2026-10-09T18:30:00+11:00'::timestamptz,'2026-10-09T19:30:00+11:00'::timestamptz,2600),
  ('lawn-stage','Closing set','2026-10-10T18:00:00+11:00'::timestamptz,'2026-10-10T19:15:00+11:00'::timestamptz,7000),
  ('river-stage','Closing support','2026-10-10T17:30:00+11:00'::timestamptz,'2026-10-10T18:30:00+11:00'::timestamptz,2500)
) as e(stage_slug,act,starts_at,ends_at,expected_people)
join zones z on z.slug = e.stage_slug;

create table mobilization_runs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  requested_by uuid not null references profiles,
  status text not null check (status in ('running','completed','failed','configuration_required')),
  input_snapshot jsonb,
  system_prompt text not null default '',
  user_prompt text not null default '',
  prompt_version text not null,
  model text,
  result jsonb,
  raw_responses jsonb not null default '[]',
  mobilization_ids uuid[] not null default '{}',
  validation_errors jsonb not null default '[]',
  error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(requested_by, request_id)
);
alter table mobilizations add column analysis_run_id uuid references mobilization_runs;
alter table tasks add column mobilization_step_key text;
alter table tasks add column required_skills text[] not null default '{}';
create unique index task_mobilization_step on tasks(mobilization_id,mobilization_step_key)
  where mobilization_step_key is not null;

alter table event_timetable enable row level security;
alter table mobilization_runs enable row level security;
grant select on event_timetable, mobilization_runs to authenticated;
create policy "Authenticated reads timetable" on event_timetable for select to authenticated using (true);
create policy "Mo reads analysis runs" on mobilization_runs for select to authenticated
  using (exists(select 1 from profiles where id = (select auth.uid()) and role::text in ('coordinator','safety_lead','admin')));

-- Writes are server-only, even for Mo. No direct authenticated insert/update/delete grants.
alter publication supabase_realtime add table event_timetable;

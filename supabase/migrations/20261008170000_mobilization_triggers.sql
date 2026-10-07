-- What starts the mobilization planner (docs/plans/2026-10-08-mobilization-plan.md, src/server/triggers.ts): a report
-- intake reads as one of the festival playbooks, reports adding up in one zone, or a reading over a playbook's line.

-- The playbook intake read a report as (src/server/playbooks/festival.ts), else null.
alter table reports add column if not exists playbook text;
-- Intake is sure of it: the report may start a plan on its own, not only add to one (decision 4 in the plan).
alter table reports add column if not exists playbook_sure boolean;

-- One measurement: a sensor, or the demo simulator until hardware is connected. `key` is from the observation catalog
-- (src/lib/mobilization-observations.ts); `value` is the number, flag or status as JSON. Written by the server only
-- (POST /api/reading with the server key).
create table readings (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  zone_id     uuid references zones,
  value       jsonb not null,
  observed_at timestamptz not null default now(),
  source      text not null check (source in ('sensor', 'simulated')),
  created_at  timestamptz not null default now()
);
create index readings_latest on readings (key, zone_id, observed_at desc);
create index readings_recent on readings (observed_at desc);
alter table readings enable row level security;
grant select on readings to authenticated;
create policy "Mo reads readings" on readings for select to authenticated
  using (exists(select 1 from profiles where id = (select auth.uid()) and role::text in ('coordinator','safety_lead','admin')));

-- A plan's playbook and what set it off: one row per report or reading, added to while the plan is pending or
-- running ("the same trigger adds evidence instead of starting another").
alter table mobilizations add column trigger_playbook text;
alter table mobilizations add column causes jsonb not null default '[]';
create index mobilizations_trigger on mobilizations (trigger_playbook, zone_id, status);

-- Triggered runs have no person asking. They carry the playbook, zone and causes while the planner works, so a second
-- trigger joins the run instead of starting another.
alter table mobilization_runs alter column requested_by drop not null;
alter table mobilization_runs add column playbook text;
alter table mobilization_runs add column zone_slug text;
alter table mobilization_runs add column causes jsonb not null default '[]';
create index mobilization_runs_trigger on mobilization_runs (playbook, zone_slug, status);

-- "Reports adding up" asks the model once per zone per window, not on every report.
create table trigger_checks (
  id         uuid primary key default gen_random_uuid(),
  zone_slug  text not null,
  task_ids   uuid[] not null,
  playbook   text,
  checked_at timestamptz not null default now()
);
create index trigger_checks_zone on trigger_checks (zone_slug, checked_at desc);
alter table trigger_checks enable row level security;

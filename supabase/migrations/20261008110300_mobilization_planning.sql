-- Versioned, Mo-authored SOPs. Existing seed playbooks remain legacy examples, not published SOPs.
create table playbook_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','published','disabled')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and content->>'slug' = slug),
  created_by uuid not null references profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  unique(slug, version),
  check ((status = 'draft' and published_at is null) or (status <> 'draft' and published_at is not null))
);
create unique index playbook_one_published_version on playbook_versions(slug) where status = 'published';

create function protect_playbook_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status <> 'draft' then raise exception 'Published playbook history cannot be deleted'; end if;
    return OLD;
  end if;
  if OLD.slug <> NEW.slug or OLD.version <> NEW.version or OLD.created_by <> NEW.created_by then
    raise exception 'Playbook identity is immutable';
  end if;
  if OLD.status <> 'draft' then
    if OLD.content is distinct from NEW.content or OLD.published_at is distinct from NEW.published_at
      or NEW.status <> 'disabled' then
      raise exception 'Published playbook content is immutable; revise it as a new draft';
    end if;
  end if;
  NEW.updated_at = clock_timestamp();
  return NEW;
end;
$$;
create trigger protect_playbook_version before update or delete on playbook_versions
  for each row execute function protect_playbook_version();

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

alter table playbook_versions enable row level security;
alter table event_timetable enable row level security;
alter table mobilization_runs enable row level security;
grant select on playbook_versions, event_timetable, mobilization_runs to authenticated;
create policy "Mo reads playbook versions" on playbook_versions for select to authenticated
  using (exists(select 1 from profiles where id = (select auth.uid()) and role::text in ('coordinator','safety_lead','admin')));
create policy "Authenticated reads timetable" on event_timetable for select to authenticated using (true);
create policy "Mo reads analysis runs" on mobilization_runs for select to authenticated
  using (exists(select 1 from profiles where id = (select auth.uid()) and role::text in ('coordinator','safety_lead','admin')));

-- Writes are server-only, even for Mo. No direct authenticated insert/update/delete grants.
alter publication supabase_realtime add table playbook_versions, event_timetable;

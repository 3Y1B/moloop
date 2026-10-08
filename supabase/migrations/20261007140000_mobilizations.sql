-- Canonical October 7 history, retained after upstream renamed this migration.
-- Guards let an already-upgraded October 8 database adopt the canonical version without changing rows.
-- Moloop migration 4: mobilizations. A multi-team response plan, system-proposed (needs Mo's approval, no
-- auto-timeout — unlike per-task P1/P2 proposals) or Mo-initiated (active immediately).
-- `steps` is authoritative only while status = 'proposed' (a non-binding preview, re-ranked fresh on
-- approval); once active, the real per-step state is the tasks themselves (tasks.mobilization_id).

do $compat$
begin
  if to_regtype('public.mobilization_status') is null then
    create type public.mobilization_status as enum ('proposed', 'active', 'stood_down', 'cancelled', 'rejected');
  end if;
end;
$compat$;

create table if not exists mobilizations (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  status            mobilization_status not null default 'proposed',
  rationale         text not null,
  related_playbooks text[] not null default '{}',
  urgency           priority not null,
  zone_id           uuid references zones,
  steps             jsonb not null,                           -- MobilizationStep[] (times in epoch ms)
  playbook_slug     text references playbooks (slug),
  decided_by        uuid references profiles,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists mobilizations_status_created_at_idx on mobilizations (status, created_at desc);

alter table tasks add column if not exists mobilization_id uuid references mobilizations on delete set null;
create index if not exists tasks_mobilization_id_idx on tasks (mobilization_id);

do $compat$
begin
  if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mobilizations') then
    alter publication supabase_realtime add table public.mobilizations;
  end if;
end;
$compat$;

alter table mobilizations enable row level security;
grant select on mobilizations to authenticated;
do $compat$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = 'mobilizations' and policyname = 'staff read mobilizations') then
    create policy "staff read mobilizations" on mobilizations for select to authenticated using ((select private.is_staff()));
  end if;
end;
$compat$;


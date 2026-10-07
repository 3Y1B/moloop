-- Moloop migration 4: mobilizations. A multi-team response plan, system-proposed (needs Mo's approval, no
-- auto-timeout — unlike per-task P1/P2 proposals) or Mo-initiated (active immediately).
-- `steps` is authoritative only while status = 'proposed' (a non-binding preview, re-ranked fresh on
-- approval); once active, the real per-step state is the tasks themselves (tasks.mobilization_id).

create type mobilization_status as enum ('proposed', 'active', 'stood_down', 'cancelled', 'rejected');

create table mobilizations (
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
create index on mobilizations (status, created_at desc);

alter table tasks add column mobilization_id uuid references mobilizations on delete set null;
create index on tasks (mobilization_id);

alter publication supabase_realtime add table mobilizations;

alter table mobilizations enable row level security;
grant select on mobilizations to authenticated;
create policy "staff read mobilizations" on mobilizations for select to authenticated using ((select private.is_staff()));

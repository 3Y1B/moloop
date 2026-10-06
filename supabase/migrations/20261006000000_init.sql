-- Moloop: volunteer coordination + incident triage for Riverside.
-- Pipeline: report -> route (can LLM handle?) -> P3 responder | triage (team / priority / rewrite) -> assignment -> task.
-- Principle: agents PROPOSE, people APPROVE anything touching safety. See agent_actions + task_assignments.

create extension if not exists "pgcrypto";

-- ───────────────────────────── enums ─────────────────────────────

create type user_role as enum ('volunteer', 'team_lead', 'coordinator', 'safety_lead', 'admin');
create type volunteer_status as enum ('invited', 'active', 'on_break', 'off_shift', 'unavailable');

create type report_channel as enum ('text', 'voice', 'radio', 'photo', 'phone', 'in_person');
create type reporter_kind as enum ('festivalgoer', 'volunteer', 'staff', 'system');

-- P1 = life/safety critical, P2 = urgent, P3 = routine/informational (AI may close alone).
create type priority as enum ('P1', 'P2', 'P3');
create type incident_category as enum (
  'medical', 'heat', 'lost_child', 'lost_property', 'crowding', 'security',
  'weather', 'facilities', 'accessibility', 'info_request', 'artist', 'vendor', 'technical', 'other'
);

create type route_decision as enum ('ai_resolved', 'escalated_to_triage');
-- Lifecycle in docs/ARCHITECTURE.md. Nudged / lead-alerted are overlays (tasks.nudge_count, lead_alerted_at), not statuses.
create type task_status as enum ('open', 'queued', 'assigned', 'accepted', 'in_progress', 'escalated', 'resolved', 'cancelled');
create type handled_by as enum ('ai', 'human');

create type shift_assignment_status as enum (
  'assigned', 'confirmed', 'checked_in', 'on_break', 'completed', 'no_show', 'swapped_out', 'released'
);

-- proposed (agent) -> approved (human) -> notified -> accepted -> en_route -> on_scene -> done
create type task_assignment_status as enum (
  'proposed', 'approved', 'rejected', 'notified', 'accepted', 'declined',
  'en_route', 'on_scene', 'done', 'reassigned'
);

create type action_type as enum (
  'assign_volunteer', 'broadcast_message', 'move_team', 'draft_incident_report',
  'request_shift_cover', 'escalate_emergency_services'
);
create type action_status as enum ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired');

create type message_scope as enum ('direct', 'team', 'zone', 'broadcast');
create type message_direction as enum ('outbound', 'inbound');

-- ───────────────────────────── site / org ─────────────────────────────

create table zones (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,              -- 'lawn-stage', 'water-station-1'
  name        text not null,
  kind        text not null default 'area',      -- stage | gate | water | first_aid | food | area
  lat         double precision,
  lng         double precision,
  capacity    integer,
  is_open_air boolean not null default true,
  created_at  timestamptz not null default now()
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,              -- see TEAM_SLUGS in src/lib/schema/enums.ts
  name        text not null,
  description text not null,                     -- fed to the team classifier as its label definition
  color       text,
  handles     incident_category[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table skills (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,         -- 'first-aid-cert', 'wwcc', 'radio-trained', 'rsa'
  name             text not null,
  requires_expiry  boolean not null default false
);

-- ───────────────────────────── people ─────────────────────────────

create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  full_name       text not null,
  phone           text,
  role            user_role not null default 'volunteer',
  team_id         uuid references teams,
  status          volunteer_status not null default 'invited',
  languages       text[] not null default '{en}',         -- BCP-47
  experience      text,                                    -- 'first_timer' | 'returning'
  push_token      text,
  last_known_zone uuid references zones,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table volunteer_skills (
  volunteer_id uuid references profiles on delete cascade,
  skill_id     uuid references skills on delete cascade,
  expires_on   date,
  verified_by  uuid references profiles,
  primary key (volunteer_id, skill_id)
);

-- Free-text availability is kept verbatim and parsed into windows by an LLM (human-reviewable).
create table availability_windows (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references profiles on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  raw_text     text,
  parsed_by    text,                                       -- model id, null if entered manually
  check (ends_at > starts_at)
);
create index on availability_windows (volunteer_id, starts_at);

-- ───────────────────────────── roster ─────────────────────────────

create table shifts (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references teams,
  zone_id            uuid references zones,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  required_count     integer not null default 1,
  required_skill_ids uuid[] not null default '{}',
  notes              text,
  check (ends_at > starts_at)
);
create index on shifts (starts_at, team_id);

create table shift_assignments (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references shifts on delete cascade,
  volunteer_id  uuid not null references profiles,
  status        shift_assignment_status not null default 'assigned',
  checked_in_at timestamptz,
  replaced_by   uuid references shift_assignments,
  created_at    timestamptz not null default now(),
  unique (shift_id, volunteer_id)
);
create index on shift_assignments (volunteer_id, status);

-- ───────────────────────────── inbound reports ─────────────────────────────

create table reports (
  id                uuid primary key default gen_random_uuid(),
  channel           report_channel not null,
  reporter_kind     reporter_kind not null default 'festivalgoer',
  reporter_id       uuid references profiles,              -- null for anonymous festivalgoers
  reporter_contact  text,                                  -- optional callback (phone / device id)
  raw_text          text,                                  -- as typed, or transcript for voice/radio
  media_url         text,                                  -- audio / photo in storage
  detected_language text,                                  -- BCP-47, set by the pipeline
  text_en           text,                                  -- machine translation for staff
  zone_id           uuid references zones,
  lat               double precision,
  lng               double precision,
  location_hint     text,                                  -- "by the red food truck"
  received_at       timestamptz not null default now()
);
create index on reports (received_at desc);

-- Full pipeline trace: every agent/classifier call, for audit + debugging + demo ("show your thinking").
create table triage_runs (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references reports on delete cascade,
  route         route_decision not null,
  route_reason  text,
  router_conf   real,
  team_result   jsonb,                                     -- Jev team classifier output
  priority_result jsonb,                                   -- priority classifier output
  rewrite_result  jsonb,                                   -- structured rewrite output
  assignment_result jsonb,                                 -- assignment agent proposal
  models        jsonb,                                     -- { router, team, priority, rewrite, assign }
  latency_ms    integer,
  error         text,
  created_at    timestamptz not null default now()
);

-- ───────────────────────────── tasks ─────────────────────────────

-- One row per report, whether the AI closed it or a human must act ("INSERT task row ... record issue response").
create table tasks (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references reports,
  triage_run_id  uuid references triage_runs,
  title          text not null,                            -- <= 60 chars, glanceable on a lock screen
  summary        text not null,                            -- <= 2 sentences, English
  category       incident_category not null,
  priority       priority not null,
  team_id        uuid references teams,
  zone_id        uuid references zones,
  status         task_status not null default 'open',
  assignee_id    uuid references profiles,                 -- current owner (also set while queued)
  assigned_at    timestamptz,
  eta_at         timestamptz,
  last_activity_at timestamptz not null default now(),     -- any volunteer reply; drives the nudge scheduler
  nudge_count    smallint not null default 0,
  last_nudge_at  timestamptz,
  lead_alerted_at timestamptz,
  handled_by     handled_by not null,
  ai_response    text,                                     -- what the P3 agent told the reporter
  response_lang  text,
  needs_human_review boolean not null default false,       -- low confidence or safety-relevant
  resolved_at    timestamptz,
  resolved_by    uuid references profiles,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on tasks (status, priority, created_at desc);
create index on tasks (team_id, status);
create index on tasks (assignee_id, status);

create table task_assignments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks on delete cascade,
  volunteer_id uuid not null references profiles,
  status       task_assignment_status not null default 'proposed',
  rationale    text,                                       -- why the agent picked them (skills, distance, load)
  distance_m   integer,
  proposed_by  text not null default 'agent',              -- 'agent' | profile id
  approved_by  uuid references profiles,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on task_assignments (volunteer_id, status);
create index on task_assignments (task_id);

-- Append-only timeline per task: also what Mo reads instead of radio replay.
create table task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks on delete cascade,
  actor_id   uuid references profiles,                     -- null = system / agent
  actor_kind text not null default 'system',               -- system | agent | human
  kind       text not null,                                -- created | triaged | proposed | approved | notified | status_changed | note
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on task_events (task_id, created_at);

-- ───────────────────────────── human-in-the-loop ─────────────────────────────

-- Anything an agent wants to DO that touches people or safety lands here first.
create table agent_actions (
  id           uuid primary key default gen_random_uuid(),
  type         action_type not null,
  task_id      uuid references tasks,
  payload      jsonb not null,                             -- typed per action in src/lib/schema/actions.ts
  rationale    text,
  status       action_status not null default 'pending',
  requested_by text not null default 'agent',
  decided_by   uuid references profiles,
  decided_at   timestamptz,
  executed_at  timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index on agent_actions (status, created_at desc);

-- ───────────────────────────── messaging (replaces the group chat) ─────────────────────────────

create table messages (
  id            uuid primary key default gen_random_uuid(),
  direction     message_direction not null default 'outbound',
  scope         message_scope not null,
  team_id       uuid references teams,
  zone_id       uuid references zones,
  sender_id     uuid references profiles,
  task_id       uuid references tasks,
  body          text not null,
  ai_drafted    boolean not null default false,
  action_id     uuid references agent_actions,             -- the approval that released this message
  created_at    timestamptz not null default now()
);

create table message_deliveries (
  message_id   uuid references messages on delete cascade,
  recipient_id uuid references profiles on delete cascade,
  body_local   text,                                       -- translated into recipient's language
  language     text,
  delivered_at timestamptz,
  read_at      timestamptz,
  primary key (message_id, recipient_id)
);

-- ───────────────────────────── playbooks (prepare before gates open) ─────────────────────────────

create table playbooks (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,                         -- 'heat-35c', 'storm-warning', 'lost-child'
  title      text not null,
  trigger    text not null,
  steps      jsonb not null,                               -- ordered [{ step, team_slug, template }]
  created_by uuid references profiles
);

-- ───────────────────────────── realtime + updated_at ─────────────────────────────

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger tasks_touch before update on tasks
  for each row execute function touch_updated_at();
create trigger task_assignments_touch before update on task_assignments
  for each row execute function touch_updated_at();

alter publication supabase_realtime add table tasks, task_assignments, task_events, agent_actions, messages, shift_assignments;

-- ───────────────────────────── RLS (hackathon-grade; tighten before real use) ─────────────────────────────

create function is_staff() returns boolean language sql stable as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('team_lead', 'coordinator', 'safety_lead', 'admin')
  )
$$;

alter table profiles           enable row level security;
alter table reports            enable row level security;
alter table tasks              enable row level security;
alter table task_assignments   enable row level security;
alter table task_events        enable row level security;
alter table agent_actions      enable row level security;
alter table shift_assignments  enable row level security;
alter table messages           enable row level security;
alter table message_deliveries enable row level security;
alter table triage_runs        enable row level security;

create policy "staff read all profiles"  on profiles for select using (is_staff() or id = auth.uid());
create policy "staff read reports"       on reports for select using (is_staff());
create policy "staff read tasks"         on tasks for select using (is_staff());
create policy "volunteer reads own task" on tasks for select using (
  exists (select 1 from task_assignments a where a.task_id = tasks.id and a.volunteer_id = auth.uid())
);
create policy "read own or staff assignments" on task_assignments for select using (volunteer_id = auth.uid() or is_staff());
create policy "volunteer updates own assignment" on task_assignments for update using (volunteer_id = auth.uid());
create policy "staff read events"        on task_events for select using (is_staff());
create policy "staff manage actions"     on agent_actions for all using (is_staff());
create policy "read own shifts"          on shift_assignments for select using (volunteer_id = auth.uid() or is_staff());
create policy "staff read triage runs"   on triage_runs for select using (is_staff());
create policy "read own deliveries"      on message_deliveries for select using (recipient_id = auth.uid() or is_staff());
create policy "read relevant messages"   on messages for select using (
  is_staff() or scope = 'broadcast'
  or exists (select 1 from message_deliveries d where d.message_id = messages.id and d.recipient_id = auth.uid())
);
-- Festivalgoer report inserts go through the server API route using the service role, so no public insert policy.

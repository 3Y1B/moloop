-- Push notifications (docs/plans/2026-10-08-push-notifications-plan.md, src/server/push.ts).

-- One row per device: an account can have several. The server writes it (POST /api/registerPush, /api/unregisterPush)
-- and prunes tokens Expo says are dead. Clients have no grants. profile_private.push_token is unused and left alone.
-- auth.users, not profiles: festival-goers (anonymous, no profile) register too, for their request's updates.
create table push_tokens (
  token      text primary key,
  person_id  uuid not null references auth.users on delete cascade,
  platform   text check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_person on push_tokens (person_id);
alter table push_tokens enable row level security;
revoke all on push_tokens from anon, authenticated;
grant all on push_tokens to service_role;

-- When a message went out as a push (to at least one of the recipient's devices).
alter table message_deliveries add column pushed_at timestamptz;

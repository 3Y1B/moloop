-- Moloop migration 3: a task can need more than one person.
-- required_count: how many people total, owner included (1 for almost every task).
-- helper_status: HelperAssignment[] (src/lib/schema/domain.ts), times in epoch ms, mirrors how `escalation` is
-- already stored. tasks.helper_ids stays a flat uuid[] in step with it, for the existing RLS `= any()` checks.

alter table tasks
  add column required_count integer not null default 1 check (required_count >= 1),
  add column helper_status  jsonb   not null default '[]';

-- Backups sent before this migration only had helper_ids. They were already working the task, so they carry over as
-- accepted; the app reads helper_status alone, and writes helper_ids back from it.
update tasks set helper_status = (
  select jsonb_agg(jsonb_build_object(
    'volunteerId', h,
    'status', 'accepted',
    'assignedAt', (extract(epoch from coalesce(assigned_at, created_at)) * 1000)::bigint,
    'respondedAt', (extract(epoch from coalesce(assigned_at, created_at)) * 1000)::bigint))
  from unnest(helper_ids) as h)
where cardinality(helper_ids) > 0;

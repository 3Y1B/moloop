-- Canonical October 7 history, retained after upstream renamed this migration.
-- Guards let an already-upgraded October 8 database adopt the canonical version without changing rows.
-- Moloop migration 3: a task can need more than one person.
-- required_count: how many people total, owner included (1 for almost every task).
-- helper_status: HelperAssignment[] (src/lib/schema/domain.ts), times in epoch ms, mirrors how `escalation` is
-- already stored. tasks.helper_ids stays a flat uuid[] in step with it, for the existing RLS `= any()` checks.

alter table tasks
  add column if not exists required_count integer not null default 1 check (required_count >= 1),
  add column if not exists helper_status  jsonb   not null default '[]';


-- Who said no to a task, as owner or helper (src/lib/commands.ts). Whoever staffs it next skips them, so an empty
-- slot is never offered back to the person who just declined it.
alter table tasks add column if not exists declined_ids uuid[] not null default '{}';

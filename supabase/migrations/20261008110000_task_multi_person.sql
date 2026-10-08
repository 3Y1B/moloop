-- Compatibility alias: upstream renamed 20261007130000_task_multi_person.sql to this version.
-- Both histories are retained. The canonical migration owns schema creation; existing rows are untouched.
-- In particular, never reconstruct helper_status from helper_ids: that could overwrite live replies.
do $compat$
begin
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'required_count')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'helper_status')) then
    raise exception 'Missing canonical prerequisite 20261007130000_task_multi_person.sql; apply all pending migrations in version order';
  end if;
end;
$compat$;

-- Compatibility alias: upstream renamed 20261007160000_mobilization_planning.sql to this version.
-- Both histories are retained. The canonical migration owns schema creation; existing rows are untouched.
-- In particular, never reconstruct helper_status from helper_ids: that could overwrite live replies.
do $compat$
begin
  if not (to_regclass('public.mobilization_runs') is not null and to_regclass('public.event_timetable') is not null
      and to_regclass('public.playbook_versions') is not null) then
    raise exception 'Missing canonical prerequisite 20261007160000_mobilization_planning.sql; apply all pending migrations in version order';
  end if;
end;
$compat$;

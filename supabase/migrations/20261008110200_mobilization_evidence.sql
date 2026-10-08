-- Compatibility alias: upstream renamed 20261007150000_mobilization_evidence.sql to this version.
-- Both histories are retained. The canonical migration owns schema creation; existing rows are untouched.
-- In particular, never reconstruct helper_status from helper_ids: that could overwrite live replies.
do $compat$
begin
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mobilizations' and column_name = 'evidence')) then
    raise exception 'Missing canonical prerequisite 20261007150000_mobilization_evidence.sql; apply all pending migrations in version order';
  end if;
end;
$compat$;

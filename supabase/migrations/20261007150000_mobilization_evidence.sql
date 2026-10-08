-- Canonical October 7 history, retained after upstream renamed this migration.
-- Guards let an already-upgraded October 8 database adopt the canonical version without changing rows.
-- Historical observations behind a system proposal. Nullable for manually initiated and older plans;
-- the UI must not reconstruct detection evidence from today's task state or current mock feed.
alter table mobilizations add column if not exists evidence jsonb;
do $compat$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.mobilizations'::regclass
      and conname = 'mobilization_evidence_object') then
    alter table mobilizations add constraint mobilization_evidence_object
      check (evidence is null or jsonb_typeof(evidence) = 'object');
  end if;
end;
$compat$;
comment on column mobilizations.evidence is
  'MobilizationEvidence detection snapshot: observedAt, windowMinutes, incidents, weather, lineup. Null when unavailable.';


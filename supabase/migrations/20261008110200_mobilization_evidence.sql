-- Historical observations behind a system proposal. Nullable for manually initiated and older plans;
-- the UI must not reconstruct detection evidence from today's task state or current mock feed.
alter table mobilizations add column evidence jsonb;
alter table mobilizations add constraint mobilization_evidence_object
  check (evidence is null or jsonb_typeof(evidence) = 'object');
comment on column mobilizations.evidence is
  'MobilizationEvidence detection snapshot: observedAt, windowMinutes, incidents, weather, lineup. Null when unavailable.';

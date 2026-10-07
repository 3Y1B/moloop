-- A model run isn't always behind a report: a festival-goer's routine question is answered by the AI and never
-- becomes one. Let a run point at the request instead.
alter table triage_runs alter column report_id drop not null;
alter table triage_runs add column request_id uuid references guest_requests on delete cascade;
alter table triage_runs add constraint triage_runs_subject check (report_id is not null or request_id is not null);
create index triage_runs_request_idx on triage_runs (request_id);

-- Deleting a run (or the request it hangs off) mustn't be blocked by the task it produced.
alter table tasks drop constraint tasks_triage_run_id_fkey;
alter table tasks add constraint tasks_triage_run_id_fkey foreign key (triage_run_id) references triage_runs on delete set null;

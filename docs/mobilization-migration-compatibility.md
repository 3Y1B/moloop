# Mobilization migration compatibility

The October 7 manual-analysis migrations were renamed upstream to October 8. A database already using the original versions must not create these tables/columns again, reconstruct live helper replies, or lose its editable playbook history.

The original five versions remain canonical, with guarded creation so a database already using the renamed versions can adopt them safely. The four renamed versions are compatibility aliases: they verify their prerequisite schema, not create it again. No alias backfills helper assignments. The new `20261008190000_manual_mobilization_compatibility.sql` adds or checks editable-playbook protection and client read access without rewriting existing SOP, task, run, or schedule rows.

The upstream roster, shift, readings/trigger-storage, and push-token migrations remain present. Trigger-storage schema does not authorize enabling the retired automatic background mobilization pipeline.

## Before upgrading an existing database

Pause the app/API server and obtain a recoverable database backup. Work from the reviewed checkout, with `DATABASE_URL` configured for the existing local database. Do not use `supabase db reset`, seed commands, `--include-seed`, or migration-history repair commands.

These commands are read-only:

```sh
supabase migration list --local
supabase db push --local --dry-run --include-all --skip-vault
bun scripts/check-mobilization-migration-compat.ts
```

The checker requires the six common baseline migrations, rejects database history missing from this checkout, and prints the reviewed pending migrations. It also prints row counts and fingerprints for existing playbooks, timetable, analysis runs, mobilizations, tasks, assignments, and message deliveries. It does not print their content or credentials.

## Reviewed local upgrade

After reviewing the pending list and backup, run:

```sh
bun scripts/check-mobilization-migration-compat.ts --apply
```

This explicit flag is local-database-only. The runner locks existing protected tables, applies only allowlisted pending files in version order, and appends only their new migration-history records. It verifies required schema, playbook RLS/read-only client grants, trigger identity, monotonic revision timestamps, original-column data fingerprints, and every original history record in the same transaction. Any failure rolls the entire upgrade back. Existing helper acceptance states, published SOP versions, live tasks and proposals must remain unchanged; new columns may be added.

Run the read-only checker again afterward. An older or newer applied migration unknown to this checkout is a stop condition, not an invitation to reset or alter history.

## Fresh databases and databases using the renamed history

Fresh Supabase databases use normal migration bootstrap in chronological order. No compatibility-runner baseline bypass is provided, and no live demo reset is required. The existing timetable fixture is inserted only when its table is first created; playbook import remains a separate explicit operation.

An existing database that already applied the renamed October 8 versions may have the restored October 7 files pending below its latest version. The local checker handles those guarded files in order. For the ordinary Supabase CLI, inspect the same plan with `--include-all`; do not mark earlier versions applied manually. If editable playbooks did not exist on that branch, their table starts empty, and their import must be explicitly planned instead of assumed.

References: [Supabase migration up](https://supabase.com/docs/reference/cli/supabase-migration-up), [Supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push). Commands were checked against the installed CLI's help.

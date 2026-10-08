/**
 * Default: read-only migration plan and preservation fingerprints.
 * Explicit --apply: local-only, atomic upgrade of the allowlisted pending compatibility migrations.
 * Never resets/seeds/repairs applied history; existing history rows and protected data are checked unchanged.
 * Stop the application server before --apply. DATABASE_URL comes from the caller's environment.
 */
import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

type Query = postgres.TransactionSql;
type Migration = { version: string; name: string; file: string; content: string };
type Fingerprint = { table: string; columns: string[]; rows: number; digest: string };
class CompatibilityError extends Error {}

const baseline = [
  '20261006000000', '20261006233415', '20261007120000',
  '20261007180000', '20261008090000', '20261008100000',
];
const permittedPending = new Set([
  '20261007130000', '20261007140000', '20261007150000', '20261007160000', '20261007161000',
  '20261008110000', '20261008110100', '20261008110200', '20261008110300',
  '20261008120000', '20261008130000', '20261008140000', '20261008150000',
  '20261008160000', '20261008170000', '20261008180000', '20261008190000',
]);
const protectedTables = [
  'playbook_versions', 'event_timetable', 'mobilization_runs', 'mobilizations',
  'tasks', 'task_assignments', 'message_deliveries',
] as const;
const expectedColumns: Record<string, string[]> = {
  playbook_versions: ['id', 'slug', 'version', 'status', 'content', 'created_by', 'created_at', 'updated_at', 'published_at'],
  event_timetable: ['id', 'stage_id', 'act', 'starts_at', 'ends_at', 'expected_people'],
  mobilization_runs: ['id', 'request_id', 'requested_by', 'input_snapshot', 'result', 'mobilization_ids', 'playbook', 'zone_slug', 'causes'],
  mobilizations: ['id', 'evidence', 'analysis_run_id', 'trigger_playbook', 'causes'],
  tasks: ['id', 'required_count', 'helper_status', 'mobilization_id', 'mobilization_step_key', 'required_skills', 'declined_ids'],
  profile_private: ['id', 'bio'],
  shift_assignments: ['reminded_at'],
  reports: ['speaker_needed', 'first_aid_needed', 'playbook', 'playbook_sure'],
  message_deliveries: ['pushed_at'],
  readings: ['id', 'key', 'zone_id', 'value', 'observed_at', 'source'],
  trigger_checks: ['id', 'zone_slug', 'task_ids', 'playbook', 'checked_at'],
  push_tokens: ['token', 'person_id', 'platform', 'updated_at'],
};

async function columns(query: Query, table: string): Promise<string[]> {
  const rows = await query<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} order by ordinal_position`;
  return rows.map((row) => row.column_name);
}

async function fingerprint(query: Query, table: string, originalColumns?: string[]): Promise<Fingerprint | null> {
  const presentColumns = await columns(query, table);
  if (!presentColumns.length) return null;
  const kept = originalColumns ?? presentColumns;
  if (kept.some((column) => !presentColumns.includes(column)))
    throw new CompatibilityError(`An existing column was removed from ${table}.`);
  const added = presentColumns.filter((column) => !kept.includes(column));
  const [row] = await query<{ rows: number; digest: string }[]>`
    select count(*)::int as rows,
      md5(coalesce(jsonb_agg((to_jsonb(t) - ${added}::text[])
        order by (to_jsonb(t) - ${added}::text[])::text), '[]'::jsonb)::text) as digest
    from ${query(`public.${table}`)} as t`;
  return { table, columns: kept, rows: row.rows, digest: row.digest };
}

async function assertCompatible(query: Query): Promise<void> {
  for (const [table, required] of Object.entries(expectedColumns)) {
    const actual = await columns(query, table);
    if (required.some((column) => !actual.includes(column)))
      throw new CompatibilityError(`The upgrade is missing required ${table} columns.`);
  }
  const [policy] = await query<{ rls: boolean; read: boolean; write: boolean; trigger: boolean; monotonic: boolean; live: boolean }[]>`
    select
      (select relrowsecurity from pg_class where oid = 'public.playbook_versions'::regclass) as rls,
      has_table_privilege('authenticated', 'public.playbook_versions', 'SELECT') as read,
      has_table_privilege('authenticated', 'public.playbook_versions', 'INSERT,UPDATE,DELETE,TRUNCATE') as write,
      exists(select 1 from pg_trigger where tgrelid = 'public.playbook_versions'::regclass
        and tgname = 'protect_playbook_version' and tgenabled in ('O', 'A') and not tgisinternal
        and tgfoid = to_regproc('public.protect_playbook_version')) as trigger,
      coalesce(position('OLD.updated_at + interval ''1 microsecond''' in
        pg_get_functiondef(to_regproc('public.protect_playbook_version'))) > 0, false) as monotonic,
      exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'playbook_versions') as live`;
  if (!policy?.rls || !policy.read || policy.write || !policy.trigger || !policy.monotonic || !policy.live)
    throw new CompatibilityError('Editable playbook protection/read-only client access is incomplete.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new CompatibilityError('Only --apply is supported; omitting it is read-only.');
  const apply = args.includes('--apply');
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new CompatibilityError('Set DATABASE_URL in the caller environment; do not paste credentials in output.');
  const target = new URL(connection);
  if (apply && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
    throw new CompatibilityError('--apply is restricted to a local database.');
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migrations: Migration[] = readdirSync(directory).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort().map((file) => {
    const [version, ...parts] = file.slice(0, -4).split('_');
    return { version, name: parts.join('_'), file, content: readFileSync(new URL(file, directory), 'utf8') };
  });
  const known = new Map(migrations.map((migration) => [migration.version, migration]));
  if (known.size !== migrations.length) throw new CompatibilityError('Duplicate local migration versions.');
  const db = postgres(connection, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    await db.begin(async (query) => {
      if (apply) {
        await query`set local lock_timeout = '10s'`;
        await query`lock table supabase_migrations.schema_migrations in exclusive mode`;
      } else {
        await query`set transaction isolation level repeatable read read only`;
      }
      const history = await query<{ version: string; name: string | null; statements: string[] | null }[]>`
        select version, name, statements from supabase_migrations.schema_migrations order by version`;
      const applied = new Set(history.map((row) => row.version));
      if (history.some((row) => !known.has(row.version)))
        throw new CompatibilityError('Database history contains a migration not present in this checkout. Stop and reconcile it first.');
      if (baseline.some((version) => !applied.has(version)))
        throw new CompatibilityError('This runner upgrades an existing baseline. Bootstrap fresh Supabase normally, without this runner.');
      const pending = migrations.filter((migration) => !applied.has(migration.version));
      if (pending.some((migration) => !permittedPending.has(migration.version)))
        throw new CompatibilityError('A pending migration is outside the reviewed compatibility upgrade.');
      console.log(`${apply ? 'Apply' : 'Read-only plan'}: ${pending.length} pending migrations.`);
      for (const migration of pending) console.log(`  ${migration.file}`);
      const before: Fingerprint[] = [];
      for (const table of protectedTables) {
        const present = await columns(query, table);
        if (!present.length) continue;
        if (apply) await query.unsafe(`lock table public.${table} in share row exclusive mode`);
        const saved = await fingerprint(query, table);
        if (saved) before.push(saved);
      }
      for (const saved of before)
        console.log(`  Preserve ${saved.table}: ${saved.rows} rows, ${saved.digest}`);
      if (!apply) {
        if (!pending.length) await assertCompatible(query);
        console.log('No schema, history, playbook, task, approval, or crew data was written.');
        return;
      }
      for (const migration of pending) {
        await query.unsafe(migration.content).simple();
        await query`insert into supabase_migrations.schema_migrations(version, name, statements)
          values (${migration.version}, ${migration.name}, ${[migration.content]}::text[])`;
      }
      await assertCompatible(query);
      for (const saved of before) {
        const after = await fingerprint(query, saved.table, saved.columns);
        if (!after || after.rows !== saved.rows || after.digest !== saved.digest)
          throw new CompatibilityError(`Existing ${saved.table} data changed; the entire upgrade has been rolled back.`);
      }
      const originalVersions = history.map((row) => row.version);
      const oldHistory = await query<{ version: string; name: string | null; statements: string[] | null }[]>`
        select version, name, statements from supabase_migrations.schema_migrations
          where version = any(${originalVersions}::text[]) order by version`;
      if (JSON.stringify(oldHistory) !== JSON.stringify(history))
        throw new CompatibilityError('Applied history changed; the entire upgrade has been rolled back.');
    });
    if (apply) console.log('Compatibility schema and history committed atomically; existing protected rows are unchanged.');
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((cause: unknown) => {
  // Database errors may include connection details: emit only our safe messages or a SQLSTATE.
  const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code.replace(/[^A-Z0-9]/g, '').slice(0, 5) : 'unknown';
  console.error(cause instanceof CompatibilityError ? cause.message : `Compatibility check failed (${code}); no partial upgrade was committed.`);
  process.exitCode = 1;
});

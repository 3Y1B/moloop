#!/usr/bin/env node
// Preflight for `npm start` and `npm run server`: local Supabase up, migrations applied, .env.local present.
// Adapted from c3-workspace's ensure-supabase.mjs, minus branch-scoped stacks.

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

// 1. Tools.
if (run('docker', ['info']).status !== 0) {
  console.error('❌ Docker is not running. Start it (Docker Desktop or OrbStack), then retry.');
  process.exit(1);
}
if (run('supabase', ['--version']).status !== 0) {
  console.error('❌ Supabase CLI not found: https://supabase.com/docs/guides/cli');
  process.exit(1);
}

// 2. Stack up.
if (run('supabase', ['status']).status === 0) {
  console.log('✓ Local Supabase already running.');
} else {
  console.log('▶️  Starting local Supabase...');
  let started = run('supabase', ['start'], { stdio: 'inherit' }).status === 0;
  if (!started) {
    // Docker died under the stack (reboot, sleep): containers are Exited but the CLI thinks it's
    // running. `supabase stop` clears that without touching the data volume.
    console.log('♻️  Start failed, clearing stale container state and retrying...');
    run('supabase', ['stop'], { stdio: 'inherit' });
    started = run('supabase', ['start'], { stdio: 'inherit' }).status === 0;
  }
  if (!started) {
    console.error('❌ supabase start failed. Fix the error above, then retry.');
    process.exit(1);
  }
}

// 3. Running db matches the migration files.
if (run('supabase', ['migration', 'up', '--local'], { stdio: 'inherit' }).status !== 0) {
  console.warn('⚠️  `supabase migration up` failed; local schema may be stale. `supabase db reset` rebuilds it.');
}

// 4. .env.local from the running stack, if missing (fresh clones and worktrees).
if (!existsSync('.env.local')) {
  const env = Object.fromEntries(
    run('supabase', ['status', '-o', 'env']).stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  writeFileSync('.env.local', [
    '# Local Supabase (supabase start). Not committed.',
    `SUPABASE_URL=${env.API_URL}`,
    `SUPABASE_SECRET_KEY=${env.SECRET_KEY}`,
    `DATABASE_URL=${env.DB_URL}`,
    `EXPO_PUBLIC_SUPABASE_URL=${env.API_URL}`,
    `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.PUBLISHABLE_KEY}`,
    '',
  ].join('\n'));
  console.log('📝 Wrote .env.local from the local stack. Seed crew with `npm run db:seed`.');
}

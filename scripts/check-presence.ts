/**
 * Live location end to end, with real sessions against the local stack and a running server:
 *  - a volunteer's phone writes presence and Mo's snapshot follows it over realtime, step by step
 *  - a P1 proposal ranks by real walking distance from presence, not by zone
 *  - the festival-goer sees who's coming only once they're on it, counting down as they walk, then "is here"
 *  - the volunteer sees the festival-goer's position, so their route ends where the person is
 *
 *   PORT=8788 SCHEDULER_MS=0 bun src/server/main.ts
 *   SERVER_URL=http://127.0.0.1:8788 npm run presence:check
 *
 * Brings its own security crew (the seeded cast has nobody on security) and removes everything it creates.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import type { Snapshot } from '../src/data/repo';
import { SupabaseRepo } from '../src/data/supabase-repo';
import { NODES, toLngLat, type Point } from '../src/data/venue';
import type { Database } from '../src/lib/database.types';
import { placeOf, PRESENCE, walkFrom, type Fix } from '../src/lib/presence';
import { routeBetween } from '../src/lib/route';
import { guestStage } from '../src/lib/status';

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const serverUrl = process.env.SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 4, onnotice: () => {} });

let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}
const section = (name: string) => console.log(`\n# ${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!(await fetch(`${serverUrl}/health`).then((r) => r.ok).catch(() => false))) {
  throw new Error(`No server at ${serverUrl}. Start one: PORT=8788 SCHEDULER_MS=0 bun src/server/main.ts`);
}

// ── pure rules ──

section('rules');
{
  const now = 1_000_000;
  const pos = (at: number, p: Point = { x: 100, y: 100 }) => ({ a: { personId: 'a', ...p, accuracy: 5, heading: null, at } });
  expect('fresh position is where to walk from', JSON.stringify(walkFrom(pos(now - 5_000), 'a', 'gate-a', now)) === '{"x":100,"y":100}');
  expect('stale (a minute quiet) falls back to the zone', walkFrom(pos(now - PRESENCE.staleMs - 1), 'a', 'gate-a', now) === 'gate-a');
  expect('stale still draws, faded', placeOf(pos(now - PRESENCE.staleMs - 1), 'a', now)?.stale === true);
  expect('gone after ten minutes', placeOf(pos(now - PRESENCE.goneMs - 1), 'a', now) === null);
  expect('off the site says nothing', placeOf(pos(now, { x: 5_000, y: -3_000 }), 'a', now) === null);
  const r = routeBetween({ x: 200, y: 100 }, 'first-aid-hq');
  expect('routes start anywhere', !!r && r.meters > 200 && r.steps.at(-1)?.turn === 'arrive', r?.meters);
  expect('a few metres off is here', routeBetween({ x: NODES.fa.x + 5, y: NODES.fa.y }, 'first-aid-hq')?.here === true);
}

// ── people ──

type Client = SupabaseClient<Database>;
const run = Date.now().toString(36);
const crewIds: string[] = [];
const guestIds: string[] = [];
const repos: SupabaseRepo[] = [];
const tracked = new Set<string>();
const id = async (table: 'teams' | 'zones', slug: string) => (await sql`select id from ${sql(table)} where slug = ${slug}`)[0].id as string;

async function signIn(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = createClient<Database>(url, publishable, opts);
  const { error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
  return client;
}

async function hire(handle: string, name: string, zone: string) {
  const email = `presence-${run}-${handle}@moloop.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  crewIds.push(data.user.id);
  await sql`insert into profiles (id, full_name, role, team_id, status, last_known_zone)
    values (${data.user.id}, ${name}, 'volunteer', ${await id('teams', 'security')}, 'active', ${await id('zones', zone)})`;
  return { id: data.user.id, client: await signIn(email) };
}

function repoFor(client: Client) {
  const repo = new SupabaseRepo(client, { serverUrl, tickMs: 60_000 });
  repos.push(repo);
  return repo;
}

function waitFor(repo: SupabaseRepo, ok: (s: Snapshot) => boolean, ms = 2_000): Promise<number> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    if (ok(repo.getSnapshot())) return resolve(0);
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
    const off = repo.subscribe(() => {
      if (!ok(repo.getSnapshot())) return;
      clearTimeout(timer);
      off();
      resolve(Math.round(performance.now() - start));
    });
  });
}

async function within(label: string, repo: SupabaseRepo, ok: (s: Snapshot) => boolean, ms = 2_000) {
  try {
    expect(`${label} (${await waitFor(repo, ok, ms)} ms)`, true);
  } catch (e) {
    expect(label, false, (e as Error).message);
  }
}

const ready = (s: Snapshot) => s.status === 'ready' && !!s.meId;
const fixAt = (p: Point): Fix => {
  const [lng, lat] = toLngLat(p);
  return { lat, lng, accuracy: 5, heading: null, at: Date.now() };
};
const near = (s: Snapshot, who: string, p: Point, m = 0.5) => {
  const at = s.positions[who];
  return !!at && Math.hypot(at.x - p.x, at.y - p.y) < m;
};

try {
  const moUser = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === 'mo@moloop.test');
  if (!moUser) throw new Error('Seed the crew first: npm run db:seed');
  // Ana is posted at Gate B and Ben at Food Alley, which is much nearer the Grove. Ana's phone says she's at the Grove.
  const [mo, ana, ben] = await Promise.all([signIn('mo@moloop.test'), hire('ana', 'Ana Presence', 'gate-b'), hire('ben', 'Ben Presence', 'food-alley')]);
  const moRepo = repoFor(mo);
  const anaRepo = repoFor(ana.client);
  const benRepo = repoFor(ben.client);
  await Promise.all([moRepo, anaRepo, benRepo].map((r) => waitFor(r, ready, 8_000)));

  section('a phone moves, Mo sees it');
  const grove = NODES.grove;
  const path: Point[] = [0, 1, 2, 3].map((i) => ({ x: grove.x + 40 - i * 10, y: grove.y + 4 }));
  for (const [i, p] of path.entries()) {
    await anaRepo.sharePosition(fixAt(p));
    await within(`step ${i + 1}: Mo's map has Ana there`, moRepo, (s) => near(s, ana.id, p), 1_500);
  }
  await within('Ben sees a teammate too', benRepo, (s) => near(s, ana.id, path.at(-1)!));

  section('assignment by walking distance');
  const zoneWalk = Math.round(routeBetween('gate-b', 'the-grove')!.meters);
  const benWalk = Math.round(routeBetween('food-alley', 'the-grove')!.meters);
  expect(`by zone alone Ben is nearer (${benWalk} m vs ${zoneWalk} m)`, benWalk < zoneWalk);
  const guest = createClient<Database>(url, publishable, opts);
  const { data: anon, error } = await guest.auth.signInAnonymously();
  if (error) throw error;
  guestIds.push(anon.user!.id);
  const guestRepo = repoFor(guest);
  await waitFor(guestRepo, ready, 8_000);
  const requestId = await guestRepo.guestAsk('Someone pulled a weapon in the Grove', 'the-grove');
  const [req] = await waitForRow(() => sql`select task_id from guest_requests where id = ${requestId} and task_id is not null`);
  const taskId = req.task_id as string;
  tracked.add(taskId);
  const [action] = await waitForRow(() => sql`select id, payload from agent_actions where task_id = ${taskId} and type = 'assign_volunteer'`);
  const cands = await sql`select volunteer_id, distance_m from task_assignments where task_id = ${taskId} and status = 'proposed'`;
  const order = (action.payload.volunteerIds ?? []) as string[];
  const ours = order.filter((v) => v === ana.id || v === ben.id);
  const anaM = cands.find((c) => c.volunteer_id === ana.id)?.distance_m;
  expect('Ana is proposed ahead of Ben', ours[0] === ana.id, { ours, cands });
  expect(`Ana's distance is from her phone (${anaM} m), not her zone (${zoneWalk} m)`, anaM != null && anaM < zoneWalk / 2, anaM);

  section('the festival-goer watches help close in');
  const view = () => {
    const s = guestRepo.getSnapshot();
    const r = s.requests[requestId];
    return r ? guestStage(r, r.taskId ? s.tasks[r.taskId] : undefined, s, Date.now()) : undefined;
  };
  // The festival-goer shares while their request is open: a few metres into the Grove.
  const person = { x: grove.x + 2, y: grove.y + 6 };
  await guestRepo.sharePosition(fixAt(person));
  await sleep(500);
  expect('before anyone is on it, they can\'t see the crew', !guestRepo.getSnapshot().positions[ana.id]);
  await moRepo.approve(action.id, ana.id);
  await anaRepo.reply(taskId, 'accept');
  await within('once Ana is on it, they see where she is', guestRepo, (s) => near(s, ana.id, path.at(-1)!), 3_000);
  await within('and Ana sees where they are', anaRepo, (s) => near(s, anon.user!.id, person));
  const anaSnap = anaRepo.getSnapshot();
  expect('Ana\'s snapshot ties the task to the festival-goer', anaSnap.requests[requestId]?.guestId === anon.user!.id);

  // Ana walks back out and in again: the countdown follows her, then she's there.
  await anaRepo.sharePosition(fixAt({ x: grove.x + 100, y: grove.y + 60 }));
  await within('walking away: "Ana is coming" with minutes', guestRepo, () => /^Ana is coming · [2-9] min$/.test(view()?.label ?? ''));
  const far = view()?.label;
  await anaRepo.sharePosition(fixAt({ x: grove.x + 40, y: grove.y + 10 }));
  await within('closer: fewer minutes', guestRepo, () => view()?.label === 'Ana is coming · 1 min');
  console.log(`     ${far} → ${view()?.label}`);
  await anaRepo.sharePosition(fixAt({ x: person.x + 4, y: person.y }));
  await within('beside them: "Ana is here"', guestRepo, () => view()?.label === 'Ana is here' && view()?.stage === 'with_you');

  section('RLS');
  const spoof = await ben.client.from('presence').upsert({ person_id: ana.id, lat: 0, lng: 0 });
  expect('nobody writes someone else\'s position', !!spoof.error || near(moRepo.getSnapshot(), ana.id, { x: person.x + 4, y: person.y }));
  const other = createClient<Database>(url, publishable, opts);
  const { data: o } = await other.auth.signInAnonymously();
  guestIds.push(o.user!.id);
  const seen = (await other.from('presence').select('person_id')).data ?? [];
  expect('another festival-goer sees nobody', seen.every((r) => r.person_id === o.user!.id), seen.length);
} catch (e) {
  failures++;
  console.log('FAIL', e instanceof Error ? e.message : e);
} finally {
  await Promise.all(repos.map((r) => r.dispose()));
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('moloop:world'))`;
    const ids = [...tracked];
    const reports = (await tx`select report_id from tasks where id = any(${ids}::uuid[])`).map((r) => r.report_id);
    await tx`delete from messages where task_id = any(${ids}::uuid[])`;
    await tx`delete from agent_actions where task_id = any(${ids}::uuid[])`;
    await tx`delete from guest_requests where guest_id = any(${guestIds}::uuid[])`;
    await tx`delete from tasks where id = any(${ids}::uuid[])`;
    await tx`delete from reports where id = any(${reports}::uuid[])`;
  });
  await Promise.all([...guestIds, ...crewIds].map((x) => admin.auth.admin.deleteUser(x)));
  await sql.end();
}

async function waitForRow<T extends readonly unknown[]>(q: () => Promise<T>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const rows = await q();
    if (rows.length) return rows;
    if (Date.now() > end) throw new Error('timed out waiting for a row');
    await sleep(100);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

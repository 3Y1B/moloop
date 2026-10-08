/**
 * Demo-day simulator (docs/PLAN-LIVE.md phase 8): drives the real server as simulated sensors and people.
 *
 * The storm at the Lawn Stage (docs/plans/2026-10-08-mobilization-plan.md, "The demo"): the stage's wind sensor reads
 * 35, 45, 55 km/h, two volunteers posted at the stage report the storm, then the wind goes over the 60 km/h limit.
 * The triggers and the planner do the rest (src/server/triggers.ts); Mo's phone shows the storm plan.
 *
 *   npm run simulate                (a step every 20 s; SERVER_URL defaults to http://127.0.0.1:8787)
 *   npm run simulate -- --fast      (a step every 2 s, for rehearsal)
 *   npm run simulate -- --gap 30    (seconds between steps)
 *
 * Readings go to POST /api/reading as `simulated`. Reports go through interpret and commit, signed in as two seeded
 * volunteers posted at the stage, so intake and triage are the real ones. Re-runnable: a storm plan already open at
 * the stage takes the new readings and reports as causes. Nothing is removed afterwards.
 */
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';
import type { MobilizationCause } from '../src/lib/schema';

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const server = process.env.SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, secret, opts);

const args = process.argv.slice(2);
const gapAt = args.indexOf('--gap');
const gapMs = (gapAt >= 0 ? Number(args[gapAt + 1]) : args.includes('--fast') ? 2 : 20) * 1000;
if (!Number.isFinite(gapMs) || gapMs < 0) throw new Error('--gap takes seconds');

const STAGE = 'lawn-stage';
const STORM = 'severe-weather-main-stage';
/** Mo dismissing a plan quiets the same playbook and zone this long (QUIET_MS in src/server/triggers.ts). */
const QUIET_MS = 15 * 60_000;
const PLAN_WAIT_MS = 3 * 60_000;

type Step = { wind: number } | { says: string };
const SCRIPT: Step[] = [
  { wind: 35 },
  { wind: 45 },
  { wind: 55 },
  { says: "Wind's ripping across the Lawn Stage now, the banners on the front truss are flapping hard and the crowd at the barrier keeps backing away from the lighting rig." },
  { says: "Storm's hitting the Lawn Stage, heavy rain and big gusts, hundreds of people at the front are scared and trying to get away from the stage, and the lighting truss is swaying." },
  { wind: 72 },
];

const start = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const say = (line: string) => console.log(`[${clock()}] ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const must = <T>(res: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> => {
  if (res.error || res.data == null) throw new Error(`${what}: ${res.error?.message ?? 'nothing'}`);
  return res.data;
};

async function post(token: string, path: string, body: unknown) {
  const res = await fetch(`${server}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// ── the stage and the people at it ──

if (!(await fetch(`${server}/health`).then((r) => r.ok).catch(() => false))) throw new Error(`No server at ${server}`);
const { data: stage } = await admin.from('zones').select('id, name').eq('slug', STAGE).single();
if (!stage) throw new Error(`No zone ${STAGE}`);
const posted = must(await admin.from('profiles').select('id, full_name, status, teams(slug)')
  .eq('last_known_zone', stage.id).eq('role', 'volunteer'), 'volunteers at the stage');
// Crowd crew on duty first: they're the ones who'd be watching the barrier.
const rank = (p: (typeof posted)[number]) => (p.teams?.slug === 'crowd' ? 0 : 2) + (p.status === 'active' ? 0 : 1);
const reporters = posted.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
if (reporters.length < 2) throw new Error(`Need two volunteers posted at ${stage.name}. Seed the crew: npm run db:seed`);

/** A session for one of the crew, as their phone would have. */
async function signIn(id: string) {
  const { data: found, error } = await admin.auth.admin.getUserById(id);
  const email = found.user?.email;
  if (error || !email) throw new Error(`user ${id}: ${error?.message ?? 'no email'}`);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(`sign-in ${email}: ${link.error.message}`);
  const client = createClient<Database>(url, publishable, opts);
  const otp = await client.auth.verifyOtp({ email, token: link.data.properties.email_otp, type: 'email' });
  if (otp.error || !otp.data.session) throw new Error(`sign-in ${email}: ${otp.error?.message ?? 'no session'}`);
  return otp.data.session.access_token;
}
const tokens = await Promise.all(reporters.map((p) => signIn(p.id)));

// Watched as Mo, so "plan for Mo" means his phone can read it.
const coordinator = must(await admin.from('profiles').select('id').eq('role', 'coordinator').limit(1), 'Mo');
if (!coordinator.length) throw new Error('No coordinator. Seed the crew: npm run db:seed');
const mo = createClient<Database>(url, publishable,
  { ...opts, global: { headers: { authorization: `Bearer ${await signIn(coordinator[0].id)}` } } });

// ── watching for the plan ──

type Plan = { id: string; title: string; status: string; causes: MobilizationCause[]; decided_at: string | null };
const openPlans = async () => must(await mo.from('mobilizations').select('id, title, status, causes, decided_at')
  .eq('trigger_playbook', STORM).eq('zone_id', stage.id).in('status', ['proposed', 'active', 'rejected'])
  .order('created_at', { ascending: false }), 'plans') as unknown as Plan[];

const before = await openPlans();
const open = before.find((p) => p.status !== 'rejected');
const dismissed = before.find((p) => p.status === 'rejected' && p.decided_at);
if (open) say(`storm plan already ${open.status} at ${stage.name}: new causes add to it`);
else if (dismissed && Date.now() - Date.parse(dismissed.decided_at!) < QUIET_MS) {
  const until = new Date(Date.parse(dismissed.decided_at!) + QUIET_MS).toLocaleTimeString();
  say(`storm plan dismissed at ${stage.name}: the wind stays quiet until ${until} (a P1 report still gets through)`);
}

const seenRuns = new Set<string>();
const causeCount = new Map(before.map((p) => [p.id, p.causes.length]));
let shown: Plan | null = null;
const describe = (c: MobilizationCause | undefined) =>
  !c ? 'nothing' : c.kind === 'report' ? `report "${c.title}"` : `${c.key} ${c.value}`;

async function watch() {
  const runs = must(await mo.from('mobilization_runs').select('id, status, error, causes')
    .eq('playbook', STORM).eq('zone_slug', STAGE).gte('created_at', new Date(start).toISOString()), 'runs');
  for (const r of runs) {
    if (!seenRuns.has(r.id)) {
      seenRuns.add(r.id);
      say(`planner started by ${describe((r.causes as MobilizationCause[])[0])}`);
    }
    if (r.status === 'failed' && !seenRuns.has(`${r.id}:failed`)) {
      seenRuns.add(`${r.id}:failed`);
      say(`planner failed: ${r.error}`);
    }
  }
  for (const p of await openPlans()) {
    if (p.status === 'rejected') continue;
    const was = causeCount.get(p.id);
    if (was === undefined) say(`plan for Mo: "${p.title}" (${p.causes.length} causes)`);
    else if (p.causes.length > was) say(`plan "${p.title}": +${p.causes.length - was} cause (${p.causes.length})`);
    causeCount.set(p.id, p.causes.length);
    shown = p;
  }
}
let watching = true;
const watcher = (async () => {
  while (watching) {
    await watch().catch((e) => say(`watch: ${(e as Error).message}`));
    await sleep(500);
  }
})();

// ── the script ──

say(`storm at ${stage.name} via ${server}, a step every ${gapMs / 1000} s`);
let said = 0;
let last = '';
for (const [i, step] of SCRIPT.entries()) {
  if (i) await sleep(gapMs);
  if ('wind' in step) {
    ({ id: last } = await post(secret, 'reading',
      { key: 'weather.windSpeed', zoneSlug: STAGE, value: step.wind, source: 'simulated' }));
    say(`wind ${step.wind} km/h at ${stage.name}${step.wind > 60 ? ' (limit 60)' : ''}`);
  } else {
    const who = said++;
    const read = await post(tokens[who], 'interpret', { text: step.says });
    const { confirmation } = await post(tokens[who], 'commit', { interpretation: read });
    say(`${reporters[who].full_name} reports: ${confirmation}`);
  }
}

// The planner takes a while: done once a plan for Mo carries the last reading.
const carries = (p: Plan | null) => !!p?.causes.some((c) => c.kind === 'reading' && c.readingId === last);
const end = Date.now() + PLAN_WAIT_MS;
while (Date.now() < end && !carries(shown)) await sleep(500);
watching = false;
await watcher;

const plan = shown as Plan | null;
if (!carries(plan)) {
  say('no storm plan with the wind limit yet: check the server log');
  process.exit(1);
}
const count = (kind: MobilizationCause['kind']) => plan!.causes.filter((c) => c.kind === kind).length;
say(`done: "${plan!.title}" ${plan!.status}, ${count('reading')} readings and ${count('report')} reports behind it`);
process.exit(0);

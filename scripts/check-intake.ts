/**
 * Runs every scenario in scripts/intake-scenarios.ts end to end, the way the server does: the live intake agent and
 * classifier, re-triage, the commands, and Postgres. Each scenario starts from an empty incident board (the crew stays),
 * replays its `setup`, sends its message, then reads back what landed: an answer, a task for the allocator, a task
 * held for a lead or Mo, or an update to an open task.
 *
 * Needs OPENAI_API_KEY (.env.local) and the local stack, which it finds itself through `supabase status`. It empties
 * tasks and requests, so it only ever uses the local database, whatever .env.local points at.
 *
 *   supabase start && bun scripts/seed.ts        once (seed.ts with the local SUPABASE_URL and SUPABASE_SECRET_KEY)
 *   npm run intake:check                          all scenarios
 *   npm run intake:check -- sec-fight medical     some, by id or group
 *   npm run intake:check -- --say "two guys fighting by the bar" [--from kai] [--zone bar]
 *                                                 one message of your own: where it lands, nothing checked
 */
import { createClient } from '@supabase/supabase-js';

import { SCENARIOS, type Route, type Said, type Scenario } from './intake-scenarios';

// The local stack, never what .env.local points at: this empties tasks and requests.
// The app's tsconfig has no Bun types; this is all the script uses.
declare const Bun: { spawnSync(cmd: string[]): { exitCode: number; stdout: { toString(): string } } };
const status = Bun.spawnSync(['supabase', 'status', '-o', 'json']);
if (status.exitCode !== 0) throw new Error('Local Supabase isn\'t running: start Docker, then `supabase start` and `bun scripts/seed.ts`');
const stack: { DB_URL: string; API_URL: string; SECRET_KEY: string } = JSON.parse(status.stdout.toString());
if (!/@(127\.0\.0\.1|localhost):/.test(stack.DB_URL)) throw new Error(`Not a local database: ${stack.DB_URL}`);
process.env.DATABASE_URL = stack.DB_URL;

const C = await import('../src/lib/commands');
const { understandRequest } = await import('../src/server/understand');
const { judgeReport } = await import('../src/server/retriage');
const { read, sql, transact } = await import('../src/server/world');

// ── who's who ──

const crew = new Map(
  (await sql()<{ id: string; email: string }[]>`select p.id, u.email from profiles p join auth.users u on u.id = p.id`)
    .map((r) => [r.email.split('@')[0], r.id]),
);
if (!crew.size) throw new Error('No crew: run bun scripts/seed.ts first');

/** The festival-goer every request comes from: an auth user, as on a phone. */
async function guestId() {
  const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false } });
  const email = 'guest@moloop.test';
  const [found] = await sql()<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (found) return found.id;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`guest: ${error.message}`);
  return data.user.id;
}
const guest = await guestId();

// ── one message, as the server handles it ──

const reset = () => sql()`truncate table tasks, guest_requests, agent_actions, messages, triage_runs, reports cascade`;

async function say(s: Said): Promise<{ requestId?: string }> {
  if (s.from === 'guest') {
    const requestId = await transact({}, (b) => C.guestAsk(b, s.text, s.zone ?? null, s.hint ?? null).id, { guestId: guest });
    await understandRequest(requestId);
    return { requestId };
  }
  const id = crew.get(s.from);
  if (!id) throw new Error(`No crew member "${s.from}"`);
  const heard = s.text;
  const { judged, matched } = await judgeReport(id, 'volunteer', heard);
  await transact({ taskIds: matched?.value ? [matched.value.taskId] : [] }, (b) => {
    const { later } = C.commit(b, id, { heard, intent: { kind: 'report' } }, judged.value, matched?.value);
    if (later) b.send(later.recipientId, 'system', later.body, { taskId: later.taskId });
  }, { reporterId: id, run: matched?.value ? { ...matched.run, taskId: matched.value.taskId } : judged.run });
  return {};
}

type Outcome = { route: Route; team?: string; priority?: string; asked?: 'lead' | 'mo'; why?: string; detail: string };

async function outcome(before: Set<string>, requestId: string | undefined): Promise<Outcome> {
  // Requests only load by id.
  const w = await read({ requestIds: requestId ? [requestId] : [] }, ({ world }) => world);
  const request = requestId ? w.requests[requestId] : undefined;
  if (request?.stage === 'answered') return { route: 'answer', detail: `“${request.aiAnswer}”` };
  const fresh = Object.values(w.tasks).filter((t) => !before.has(t.id));
  if (!fresh.length) {
    const joined = request?.taskId ? w.tasks[request.taskId] : Object.values(w.tasks)[0];
    return { route: 'joined', team: joined?.teamSlug ?? undefined, priority: joined?.priority, detail: `joined “${joined?.title}”` };
  }
  const t = fresh[0];
  const asks = await sql()<{ body: string; role: string }[]>`
    select m.body, p.role from messages m join message_deliveries d on d.message_id = m.id join profiles p on p.id = d.recipient_id
    where m.task_id = ${t.id} and m.body like 'Needs your call%'`;
  const asked = asks.some((a) => a.role === 'coordinator') ? 'mo' : asks.length ? 'lead' : undefined;
  const held = t.escalation?.source === 'intake';
  const route: Route = held ? (t.escalation!.level === 'coordinator' ? 'mo' : 'lead') : 'allocator';
  const who = t.assigneeId ? w.volunteers[t.assigneeId]?.name : Object.values(w.proposals).some((p) => p.taskId === t.id) ? 'proposal for approval' : 'unassigned';
  const why = held ? t.escalation!.reason ?? undefined : asks[0]?.body.replace(/^Needs your call: [^.]*\.\s*/, '');
  return { route, team: t.teamSlug ?? undefined, priority: t.priority, asked, why, detail: `“${t.title}” → ${held ? 'held' : who}` };
}

// ── run ──

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const typed = flag('--say');
const from = flag('--from') ?? 'guest';
const zone = flag('--zone');
if (from !== 'guest' && !crew.has(from)) throw new Error(`No crew member "${from}". Try: guest, ${[...crew.keys()].slice(0, 8).join(', ')}, …`);
// --say: one message of your own, every route allowed, so it only reports where it went.
const yours: Scenario | undefined = typed ? { id: 'yours', group: 'your message', from, text: typed, zone, route: ['answer', 'allocator', 'lead', 'mo', 'joined'] } : undefined;
const chosen = yours ? [yours] : args.length ? SCENARIOS.filter((s) => args.includes(s.id) || args.includes(s.group)) : SCENARIOS;
if (!chosen.length) throw new Error(`No scenario or group named ${args.join(', ')}`);
const list = <T>(x: T | T[]) => (Array.isArray(x) ? x : [x]);
const failed: string[] = [];
let group = '';

for (const s of chosen) {
  if (s.group !== group) console.log(`\n── ${(group = s.group)} ──`);
  await reset();
  try {
    for (const earlier of s.setup ?? []) await say(earlier);
    const before = new Set(Object.keys(await read({}, ({ world }) => world.tasks)));
    const t0 = Date.now();
    const { requestId } = await say(s);
    const o = await outcome(before, requestId);
    const misses = [
      !list(s.route).includes(o.route) && `route ${o.route}, wanted ${list(s.route).join('/')}`,
      s.team && o.team && !s.team.includes(o.team as never) && `team ${o.team}, wanted ${s.team.join('/')}`,
      s.priority && o.priority && o.route !== 'joined' && !s.priority.includes(o.priority as never) && `priority ${o.priority}, wanted ${s.priority.join('/')}`,
      s.notifies && o.route === 'allocator' && o.asked !== s.notifies && `asked ${o.asked ?? 'nobody'} to decide, wanted ${s.notifies}`,
    ].filter(Boolean);
    if (misses.length) failed.push(s.id);
    const head = [o.route, o.team, o.priority, o.asked && `asks ${o.asked}`].filter(Boolean).join(' ');
    console.log(`${misses.length ? 'FAIL' : 'ok  '} ${s.id.padEnd(22)} ${head.padEnd(30)} ${Date.now() - t0} ms  ${o.detail}${o.why ? `  — ${o.why}` : ''}`);
    if (misses.length) console.log(`     “${s.text}”: ${misses.join('; ')}`);
  } catch (e) {
    failed.push(s.id);
    console.log(`FAIL ${s.id.padEnd(22)} threw: ${(e as Error).message}`);
  }
}

await reset();
console.log(`\n${chosen.length - failed.length}/${chosen.length} passed${failed.length ? `\nfailed: ${failed.join(', ')}` : ''}`);
await sql().end();
process.exit(failed.length ? 1 : 0);

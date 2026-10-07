/**
 * Drives SupabaseRepo with real local sessions and checks that:
 *  - each role's hydrated snapshot is what RLS should give it (volunteer, lead, festival-goer)
 *  - service-role writes reach a subscribed snapshot over realtime within about a second
 *  - every command POSTs the contract shape (to a stub server here, not the real one)
 *  - signing out and in as someone else resubscribes
 * Creates throwaway rows and removes them. Run after `npm run db:seed` against local Supabase.
 *
 *   bun scripts/check-repo.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { CommandError, SupabaseRepo } from '../src/data/supabase-repo';
import type { Snapshot } from '../src/data/repo';
import type { Database } from '../src/lib/database.types';

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
if (!url || !secret || !publishable) throw new Error('Set SUPABASE_URL, SUPABASE_SECRET_KEY, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env.local)');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, secret, opts);

let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

// ── stub command server: records what the repo sends ──

type Recorded = { method: string; auth: string | null; body: Record<string, unknown> };
const recorded: Recorded[] = [];
let requestIdForAsk = '';
function answer(method: string, body: Record<string, unknown>): [number, unknown] {
  if (body.taskId === 'conflict') return [409, { error: 'task_changed' }];
  if (method === 'setDuty' && body.duty === 'off_shift') return [502, { error: 'pipeline_failed' }];
  switch (method) {
    case 'interpret': return [200, { heard: body.text, intent: { kind: 'report' } }];
    case 'commit': return [200, { confirmation: 'Report sent' }];
    case 'guestAsk': return [200, { requestId: requestIdForAsk }];
    case 'guestAddDetail': return [200, { escalated: true }];
    default: return [200, {}];
  }
}

// The app's tsconfig has no Bun types; this is all the script uses.
declare const Bun: {
  serve(o: { port: number; hostname: string; fetch(req: Request): Promise<Response> }): { port: number; stop(force?: boolean): void };
};

const stub = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const method = path.replace(/^\/api\//, '');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    recorded.push({ method, auth: req.headers.get('authorization'), body });
    const [status, json] = req.method === 'POST' && path.startsWith('/api/') ? answer(method, body) : [404, { error: 'not_found' }];
    return Response.json(json, { status });
  },
});
const serverUrl = `http://127.0.0.1:${stub.port}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── sessions ──

type Client = SupabaseClient<Database>;

async function signIn(client: Client, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const { error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
}

async function crew(email: string) {
  const client = createClient<Database>(url, publishable, opts);
  await signIn(client, email);
  return client;
}

const repos: SupabaseRepo[] = [];
function repoFor(client: Client) {
  const repo = new SupabaseRepo(client, { serverUrl, tickMs: 60_000 });
  repos.push(repo);
  return repo;
}

/** Resolves with how long it took for the snapshot to satisfy `ok`, or rejects after `ms`. */
function waitFor(repo: SupabaseRepo, ok: (s: Snapshot) => boolean, ms = 1_500): Promise<number> {
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

async function within(label: string, repo: SupabaseRepo, ok: (s: Snapshot) => boolean, ms = 1_500) {
  try {
    const took = await waitFor(repo, ok, ms);
    expect(`${label} (${took} ms)`, true);
  } catch (e) {
    expect(label, false, (e as Error).message);
  }
}

const ready = (s: Snapshot) => s.status === 'ready' && !!s.meId;

async function userId(email: string) {
  const { data } = await admin.auth.admin.listUsers();
  return data.users.find((u) => u.email === email)!.id;
}

const [priya, tom, linh, jordan] = await Promise.all(['priya', 'tom', 'linh', 'jordan'].map((n) => userId(`${n}@moloop.test`)));

// ── fixtures, written as the server would (service role) ──

const guestClient = createClient<Database>(url, publishable, opts);
const { data: anon, error: anonErr } = await guestClient.auth.signInAnonymously();
if (anonErr) throw anonErr;
const guestId = anon.user!.id;

const one = async <T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> => {
  const { data, error } = await q;
  if (error || !data) throw new Error(`${what}: ${error?.message ?? 'no data'}`);
  return data;
};

// A run killed before its `finally` leaves its tasks on everyone's screens ("repo: open" in Mo's list): clear them first.
async function sweepLeftovers() {
  const { data: reports } = await admin.from('reports').select('id').like('raw_text', 'repo check%');
  const reportIds = (reports ?? []).map((r) => r.id);
  if (!reportIds.length) return;
  const { data: old } = await admin.from('tasks').select('id').in('report_id', reportIds);
  const ids = (old ?? []).map((t) => t.id);
  if (ids.length) {
    const { data: msgs } = await admin.from('messages').select('id').in('task_id', ids);
    const msgIds = (msgs ?? []).map((m) => m.id);
    if (msgIds.length) await admin.from('message_deliveries').delete().in('message_id', msgIds);
    await admin.from('messages').delete().in('task_id', ids);
    await admin.from('agent_actions').delete().in('task_id', ids);
    await admin.from('task_assignments').delete().in('task_id', ids);
    await admin.from('task_events').delete().in('task_id', ids);
    await admin.from('guest_requests').delete().in('task_id', ids);
    await admin.from('tasks').delete().in('id', ids);
  }
  await admin.from('reports').delete().in('id', reportIds);
  console.log(`swept ${ids.length} leftover task(s) from an earlier run`);
}
await sweepLeftovers();

const report = await one(admin.from('reports').insert({
  channel: 'voice', reporter_kind: 'volunteer', reporter_id: tom, raw_text: 'repo check: he is dizzy', detected_language: 'en',
}).select('id').single(), 'report');
const { data: zone } = await admin.from('zones').select('id').eq('slug', 'water-2').single();
const { data: team } = await admin.from('teams').select('id').eq('slug', 'first-aid').single();
const task = (title: string, assignee: string | null, status: Database['public']['Enums']['task_status'] = 'assigned') => ({
  report_id: report.id, title, summary: title, category: 'medical' as const, priority: 'P2' as const, status,
  assignee_id: assignee, handled_by: 'human' as const, zone_id: zone!.id, team_id: team!.id,
  escalation: null, location_hint: 'by the taps',
});
const tasks = await one(admin.from('tasks').insert([
  task('repo: priya', priya), task('repo: linh', linh), task('repo: tom', tom), task('repo: open', null, 'open'),
]).select('id, title'), 'tasks');
const T = Object.fromEntries(tasks.map((t) => [t.title.replace('repo: ', ''), t.id])) as Record<'priya' | 'linh' | 'tom' | 'open', string>;
const taskIds = Object.values(T);

const request = await one(admin.from('guest_requests').insert({
  guest_id: guestId, heard: 'repo check', task_id: T.tom, stage: 'finding', zone_id: zone!.id,
  thread: [{ from: 'guest', text: 'repo check', at: Date.now() }],
}).select('id').single(), 'request');
requestIdForAsk = request.id;
await admin.from('tasks').update({ request_id: request.id }).eq('id', T.tom);

await admin.from('task_events').insert([
  { task_id: T.priya, actor_kind: 'agent', kind: 'created', data: { text: 'Reported by Tom Becker', actorName: 'Triage' } },
  { task_id: T.priya, actor_kind: 'human', actor_id: jordan, kind: 'assigned', data: { text: 'Assigned to Priya' } },
]);

// A proposal for the open task: Tom first, then Priya (inserted the other way round, so order comes from the payload).
await admin.from('task_assignments').insert([
  { task_id: T.open, volunteer_id: priya, rationale: 'free · 200 m', distance_m: 200 },
  { task_id: T.open, volunteer_id: tom, rationale: 'free · 80 m', distance_m: 80 },
]);
const action = await one(admin.from('agent_actions').insert({
  type: 'assign_volunteer', task_id: T.open, payload: { type: 'assign_volunteer', taskId: T.open, volunteerIds: [tom, priya] },
  auto_assign_at: new Date(Date.now() + 30_000).toISOString(),
}).select('id').single(), 'action');

const message = await one(admin.from('messages').insert({
  scope: 'direct', sender_id: jordan, body: 'repo check: grab a fresh bag', kind: 'direct', task_id: null,
}).select('id').single(), 'message');
await admin.from('message_deliveries').insert({ message_id: message.id, recipient_id: priya, delivery: 'spoken' });
const messageIds = [message.id];

const P = await crew('priya@moloop.test');
const J = await crew('jordan@moloop.test');
const priyaRepo = repoFor(P);
const leadRepo = repoFor(J);
const guestRepo = repoFor(guestClient);

try {
  await Promise.all([priyaRepo, leadRepo, guestRepo].map((r) => waitFor(r, ready, 8_000)));
  // Give realtime a moment past the join before writing.
  await sleep(300);

  // ── volunteer ──
  {
    const s = priyaRepo.getSnapshot();
    const mine = Object.values(s.tasks).filter((t) => taskIds.includes(t.id));
    expect('volunteer: meId is the auth user, not a guest', s.meId === priya && s.guestId === null);
    expect('volunteer: sees their own task and the one they were proposed for, nobody else\'s',
      mine.map((t) => t.id).sort().join() === [T.priya, T.open].sort().join(), mine.map((t) => t.title));
    const t = s.tasks[T.priya];
    expect('volunteer: task maps slugs, hint and reporter', t?.teamSlug === 'first-aid' && t.zoneSlug === 'water-2'
      && t.locationHint === 'by the taps' && t.reporter.kind === 'volunteer' && t.reporter.name === 'Tom Becker'
      && t.reporter.quote === 'repo check: he is dizzy', t);
    expect('volunteer: times are epoch ms', typeof t?.createdAt === 'number' && Math.abs(t.createdAt - Date.now()) < 60_000);
    expect('volunteer: sees all crew', Object.keys(s.volunteers).length >= 6);
    const me = s.volunteers[priya];
    expect('volunteer: own profile maps duty, zone, skills, phone', me?.duty === 'on_duty' && me.zoneSlug === 'lawn-stage'
      && me.skills.includes('first-aid-cert') && me.role === 'volunteer' && me.teamSlug === 'first-aid', me);
    const evs = s.events.filter((e) => e.taskId === T.priya);
    expect('volunteer: events with actor names', evs.length === 2 && evs[0].actor.name === 'Triage' && evs[1].actor.name === 'Jordan Lee', evs);
    const m = s.messages.find((x) => x.id === message.id);
    expect('volunteer: message from the sender, unread, spoken', m?.fromName === 'Jordan Lee' && !m.read && m.delivery === 'spoken'
      && m.recipientId === priya && m.kind === 'direct', m);
    expect('volunteer: no proposals, no requests', Object.keys(s.proposals).length === 0 && Object.keys(s.requests).length === 0);
    expect('volunteer: team icons from the app', s.teams['first-aid']?.sf === 'cross.case.fill' && !!s.zones['water-2']);
  }

  // ── lead ──
  {
    const s = leadRepo.getSnapshot();
    const seen = Object.values(s.tasks).filter((t) => taskIds.includes(t.id));
    expect('lead: sees every task', seen.length === 4, seen.map((t) => t.title));
    const p = s.proposals[action.id];
    expect('lead: proposal with candidates in proposed order', p?.status === 'pending' && p.taskId === T.open
      && p.candidates.map((c) => c.volunteerId).join() === [tom, priya].join() && p.candidates[0].distanceM === 80, p);
    expect('lead: proposal auto-assign time in ms', !!p && p.autoAssignAt > Date.now() && p.autoAssignAt - p.createdAt <= 31_000);
    expect('lead: sees the guest request', !!s.requests[request.id]);
    expect('lead: can read phone numbers', s.volunteers[tom]?.phone !== undefined);
    expect('lead: no inbox of other people\'s messages', !s.messages.some((x) => x.recipientId !== jordan));
  }

  // ── festival-goer ──
  {
    const s = guestRepo.getSnapshot();
    expect('guest: guestId is meId (useRole → guest)', s.meId === guestId && s.guestId === guestId);
    const r = s.requests[request.id];
    expect('guest: own request only', Object.keys(s.requests).length === 1 && r?.stage === 'finding' && r.taskId === T.tom
      && r.zoneSlug === 'water-2' && r.thread.length === 1, s.requests);
    expect('guest: only their request\'s task', Object.keys(s.tasks).length === 1 && !!s.tasks[T.tom], Object.keys(s.tasks));
    expect('guest: sees who is coming, no one else', Object.keys(s.volunteers).join() === tom, Object.keys(s.volunteers));
    expect('guest: no phone numbers', s.volunteers[tom]?.phone === null);
    expect('guest: no events, messages or proposals', !s.events.length && !s.messages.length && !Object.keys(s.proposals).length);
  }

  // ── realtime ──
  await admin.from('tasks').update({ status: 'accepted', last_activity_at: new Date().toISOString() }).eq('id', T.priya);
  await Promise.all([
    within('realtime: task status reaches the volunteer', priyaRepo, (s) => s.tasks[T.priya]?.status === 'accepted'),
    within('realtime: task status reaches the lead', leadRepo, (s) => s.tasks[T.priya]?.status === 'accepted'),
  ]);
  expect('realtime: patched task keeps its reporter', priyaRepo.getSnapshot().tasks[T.priya]?.reporter.name === 'Tom Becker');

  const m2 = await one(admin.from('messages').insert({ scope: 'direct', body: 'repo check: nudge', kind: 'nudge', task_id: T.priya })
    .select('id').single(), 'message 2');
  messageIds.push(m2.id);
  await admin.from('message_deliveries').insert({ message_id: m2.id, recipient_id: priya, delivery: 'ping' });
  await within('realtime: new delivery reaches the inbox', priyaRepo,
    (s) => s.messages.some((x) => x.id === m2.id && x.fromName === 'Moloop' && x.delivery === 'ping' && x.taskId === T.priya));

  await admin.from('guest_requests').update({ stage: 'coming' }).eq('id', request.id);
  await within('realtime: request stage reaches the festival-goer', guestRepo, (s) => s.requests[request.id]?.stage === 'coming');

  await admin.from('tasks').update({ helper_ids: [linh] }).eq('id', T.tom);
  await within('realtime: a new helper shows up for the festival-goer', guestRepo,
    (s) => s.tasks[T.tom]?.helperIds.includes(linh) && !!s.volunteers[linh]);

  await admin.from('task_events').insert({ task_id: T.priya, actor_kind: 'human', actor_id: priya, kind: 'reply', data: { text: 'Accepted', reply: 'accept' } });
  await within('realtime: task event reaches the volunteer', priyaRepo,
    (s) => s.events.some((e) => e.taskId === T.priya && e.kind === 'reply' && e.reply === 'accept' && e.actor.name === 'Priya Shah'));

  await admin.from('agent_actions').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', action.id);
  await admin.from('task_assignments').update({ status: 'notified' }).eq('task_id', T.open).eq('volunteer_id', tom);
  await within('realtime: auto-assigned proposal reaches the lead', leadRepo,
    (s) => s.proposals[action.id]?.status === 'auto_assigned' && s.proposals[action.id]?.volunteerId === tom);

  await admin.from('profiles').update({ status: 'on_break' }).eq('id', tom);
  await within('realtime: duty change reaches the lead', leadRepo, (s) => s.volunteers[tom]?.duty === 'on_break');
  await admin.from('profiles').update({ status: 'active' }).eq('id', tom);

  // ── commands: contract shape ──
  recorded.length = 0;
  const pToken = (await P.auth.getSession()).data.session!.access_token;
  const jToken = (await J.auth.getSession()).data.session!.access_token;
  const gToken = (await guestClient.auth.getSession()).data.session!.access_token;

  const interpretation = await priyaRepo.interpret('there is a spill');
  const results = {
    interpret: interpretation,
    commit: await priyaRepo.commit(interpretation),
    guestAsk: await guestRepo.guestAsk('where is water', 'water-2'),
    guestAddDetail: await guestRepo.guestAddDetail(request.id, 'she is worse'),
  };
  await priyaRepo.reply(T.priya, 'still_on_it', 'two more minutes');
  await priyaRepo.reply(T.priya, 'done');
  await priyaRepo.markRead([message.id]);
  await leadRepo.respond(T.tom, { kind: 'backup', volunteerId: linh });
  await leadRepo.passToCoordinator(T.tom);
  await leadRepo.arrived(T.tom);
  await leadRepo.assign(T.open, priya);
  await leadRepo.approve(action.id, tom);
  await leadRepo.approve(action.id);
  await leadRepo.broadcast('drink water', { teamSlug: 'first-aid' });
  await leadRepo.broadcast('everyone');
  await leadRepo.sendDirect(priya, 'hi');
  await guestRepo.guestFollowUp(request.id, 'still lost');
  await guestRepo.guestCancel(request.id);
  await guestRepo.guestReopen(request.id);
  await priyaRepo.guestReply(T.tom, 'on my way');
  await priyaRepo.setDuty('on_break');

  const expected: [string, string, Record<string, unknown>][] = [
    ['interpret', pToken, { text: 'there is a spill' }],
    ['commit', pToken, { interpretation: { heard: 'there is a spill', intent: { kind: 'report' } } }],
    ['guestAsk', gToken, { text: 'where is water', zoneSlug: 'water-2' }],
    ['guestAddDetail', gToken, { requestId: request.id, text: 'she is worse' }],
    ['reply', pToken, { taskId: T.priya, reply: 'still_on_it', note: 'two more minutes' }],
    ['reply', pToken, { taskId: T.priya, reply: 'done' }],
    ['markRead', pToken, { messageIds: [message.id] }],
    ['respond', jToken, { taskId: T.tom, response: { kind: 'backup', volunteerId: linh } }],
    ['passToCoordinator', jToken, { taskId: T.tom }],
    ['arrived', jToken, { taskId: T.tom }],
    ['assign', jToken, { taskId: T.open, volunteerId: priya }],
    ['approve', jToken, { proposalId: action.id, volunteerId: tom }],
    ['approve', jToken, { proposalId: action.id }],
    ['broadcast', jToken, { body: 'drink water', scope: { teamSlug: 'first-aid' } }],
    ['broadcast', jToken, { body: 'everyone' }],
    ['sendDirect', jToken, { volunteerId: priya, body: 'hi' }],
    ['guestFollowUp', gToken, { requestId: request.id, text: 'still lost' }],
    ['guestCancel', gToken, { requestId: request.id }],
    ['guestReopen', gToken, { requestId: request.id }],
    ['guestReply', pToken, { taskId: T.tom, text: 'on my way' }],
    ['setDuty', pToken, { duty: 'on_break' }],
  ];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  expected.forEach(([method, token, body], i) => {
    const r = recorded[i];
    expect(`command: POST /api/${method} ${JSON.stringify(body).slice(0, 60)}`,
      r?.method === method && r.auth === `Bearer ${token}` && same(r.body, body), r);
  });
  expect('command: no extra requests', recorded.length === expected.length, recorded.length);
  expect('command: results come back typed', results.interpret.intent.kind === 'report' && results.commit.confirmation === 'Report sent'
    && results.guestAsk === request.id && results.guestAddDetail.escalated === true, results);

  // Optimistic: markRead and setDuty show at once (the stub doesn't write, so this is the local change).
  expect('optimistic: markRead flips read straight away', priyaRepo.getSnapshot().messages.find((x) => x.id === message.id)?.read === true);
  expect('optimistic: setDuty flips duty straight away', priyaRepo.getSnapshot().volunteers[priya]?.duty === 'on_break');

  // Errors: { error } with the status, and an optimistic change rolled back.
  try {
    await leadRepo.assign('conflict', priya);
    expect('error: 409 throws', false);
  } catch (e) {
    expect('error: 409 throws CommandError with the server message', e instanceof CommandError && e.status === 409 && e.message === 'task_changed', String(e));
  }
  try {
    await priyaRepo.setDuty('off_shift');
    expect('error: 502 throws', false);
  } catch (e) {
    expect('error: 502 throws CommandError', e instanceof CommandError && e.status === 502, String(e));
  }
  expect('error: failed setDuty rolls back to the database', priyaRepo.getSnapshot().volunteers[priya]?.duty === 'on_duty',
    priyaRepo.getSnapshot().volunteers[priya]?.duty);

  // ── session change: sign out, sign in as someone else ──
  await P.auth.signOut({ scope: 'local' });
  await within('session: signing out empties the snapshot', priyaRepo, (s) => s.status === 'ready' && s.meId === null && !Object.keys(s.tasks).length, 3_000);
  await signIn(P, 'linh@moloop.test');
  await within('session: signing in as someone else rehydrates', priyaRepo,
    (s) => ready(s) && s.meId === linh && !!s.tasks[T.linh] && !s.tasks[T.priya], 8_000);
  await sleep(300);
  await admin.from('tasks').update({ status: 'in_progress' }).eq('id', T.linh);
  await within('session: realtime resubscribed for the new user', priyaRepo, (s) => s.tasks[T.linh]?.status === 'in_progress');

  // ── deletes ──
  await admin.from('task_events').delete().eq('task_id', T.priya);
  await within('realtime: deleted events leave the lead\'s snapshot', leadRepo, (s) => !s.events.some((e) => e.taskId === T.priya));
} finally {
  for (const r of repos) await r.dispose();
  await admin.from('message_deliveries').delete().in('message_id', messageIds);
  await admin.from('messages').delete().in('id', messageIds);
  await admin.from('agent_actions').delete().eq('id', action.id);
  await admin.from('task_assignments').delete().in('task_id', taskIds);
  await admin.from('task_events').delete().in('task_id', taskIds);
  await admin.from('tasks').update({ request_id: null }).in('id', taskIds);
  await admin.from('guest_requests').delete().eq('id', request.id);
  await admin.from('tasks').delete().in('id', taskIds);
  await admin.from('reports').delete().eq('id', report.id);
  await admin.from('profiles').update({ status: 'active' }).in('id', [tom, priya]);
  await admin.auth.admin.deleteUser(guestId);
  stub.stop(true);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

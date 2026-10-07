/**
 * Drives the running server over HTTP as real sessions (crew via email OTP, festival-goers via anonymous
 * sign-in) and checks what each command writes. Needs the server on fast timings:
 *
 *   POLICY_SCALE=0.05 POLICY_AUTO_ASSIGN_MS=3000 SCHEDULER_MS=500 npm run server
 *   npm run commands:check            (SERVER_URL defaults to http://127.0.0.1:8787)
 *
 * It brings its own crew: a security lead, two security volunteers and one artist liaison. The seeded
 * cast has nobody on those teams, so assignment always lands on them, whatever else is going on in the
 * local stack. Seeded Mo is the one shared account (the coordinator). Everything it creates is removed.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import { setPolicy, type Policy } from '../src/lib/lifecycle';
import { schedulerPass } from '../src/server/scheduler';

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const server = process.env.SERVER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`;
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
async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

// ── server ──

const health = await fetch(`${server}/health`).then((r) => r.json()).catch(() => null) as { policy: Policy } | null;
if (!health) throw new Error(`No server at ${server}. Start it with: POLICY_SCALE=0.05 POLICY_AUTO_ASSIGN_MS=3000 SCHEDULER_MS=500 npm run server`);
const policy = health.policy;
if (policy.ackTimeoutMs > 15_000) throw new Error('The server is on real timings. Restart it with POLICY_SCALE=0.05 POLICY_AUTO_ASSIGN_MS=3000 SCHEDULER_MS=500');
// The in-process scheduler below plays a second server, so it runs on the same timings.
setPolicy(policy);

type Res = { status: number; body: any };
async function post(token: string | null, name: string, body: unknown): Promise<Res> {
  const res = await fetch(`${server}/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── people ──

type Person = { id: string; client: SupabaseClient; call: (name: string, body?: unknown) => Promise<Res> };

async function signIn(email: string, id: string): Promise<Person> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = createClient(url, publishable, opts);
  const { data: v, error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
  const token = v.session!.access_token;
  return { id, client, call: (n, b = {}) => post(token, n, b) };
}

const run = Date.now().toString(36);
const crewIds: string[] = [];
const teamId = async (slug: string) => (await sql`select id from teams where slug = ${slug}`)[0].id as string;
const zoneId = async (slug: string) => (await sql`select id from zones where slug = ${slug}`)[0].id as string;

/** A throwaway crew member for this run: auth user, profile on duty, signed in. */
async function hire(handle: string, name: string, role: 'volunteer' | 'team_lead', team: string, zone: string): Promise<Person> {
  const email = `check-${run}-${handle}@moloop.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  crewIds.push(id);
  await sql`insert into profiles (id, full_name, role, team_id, status, last_known_zone)
    values (${id}, ${name}, ${role}, ${await teamId(team)}, 'active', ${await zoneId(zone)})`;
  return signIn(email, id);
}

const guestIds: string[] = [];
async function guest() {
  const client = createClient(url, publishable, opts);
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  guestIds.push(data.user!.id);
  const token = data.session!.access_token;
  return { id: data.user!.id, client, call: (n: string, b: unknown = {}) => post(token, n, b) };
}

const moUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === 'mo@moloop.test');
if (!moUser) throw new Error('Seed the crew first: npm run db:seed');
const mo = await signIn('mo@moloop.test', moUser.id);
const lee = await hire('lee', 'Lee Check', 'team_lead', 'security', 'river-stage');
const ana = await hire('ana', 'Ana Check', 'volunteer', 'security', 'gate-b');
const ben = await hire('ben', 'Ben Check', 'volunteer', 'security', 'food-alley');
const cam = await hire('cam', 'Cam Check', 'volunteer', 'artist', 'backstage');

// ── reading what the server wrote ──

const tracked = new Set<string>();
const task = async (id: string) => (await sql`select * from tasks where id = ${id}`)[0];
const eventKinds = async (id: string) => (await sql`select kind from task_events where task_id = ${id} order by created_at`).map((e) => e.kind as string);
const events = (id: string) => sql`select kind, actor_id, data from task_events where task_id = ${id} order by created_at`;
const messagesFor = (taskId: string, who: Person) => sql`
  select m.kind, m.body, d.delivery from messages m join message_deliveries d on d.message_id = m.id
  where m.task_id = ${taskId} and d.recipient_id = ${who.id} order by m.created_at`;
const assignments = (taskId: string) => sql`select volunteer_id, status from task_assignments where task_id = ${taskId} order by created_at`;
const count = (xs: string[], k: string) => xs.filter((x) => x === k).length;
const sameKinds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Talk into the pill: interpret, then commit. Returns the task a report became. */
async function say(who: Person, text: string) {
  const i = await who.call('interpret', { text });
  const res = await who.call('commit', { interpretation: i.body });
  const [t] = await sql`select t.id from tasks t join reports r on r.id = t.report_id where r.reporter_id = ${who.id} order by t.created_at desc limit 1`;
  if (t) tracked.add(t.id);
  return { interpretation: i, commit: res, taskId: t?.id as string };
}

/** A festival-goer asks; resolves once the AI step has run. */
async function ask(g: Awaited<ReturnType<typeof guest>>, text: string, zoneSlug: string) {
  const res = await g.call('guestAsk', { text, zoneSlug });
  if (res.status !== 200) throw new Error(`guestAsk ${res.status} ${JSON.stringify(res.body)}`);
  const req = await until('the request to be understood', async () =>
    (await sql`select * from guest_requests where id = ${res.body.requestId} and stage <> 'understanding'`)[0]);
  if (req.task_id) tracked.add(req.task_id);
  return req;
}

try {
  // ── 1. A volunteer accepts and completes their task ──
  section('volunteer accepts and completes');
  {
    const r = await say(cam, 'A drunk guy is getting aggressive near the bar');
    expect('a report reads as a report', r.interpretation.status === 200 && r.interpretation.body.intent.kind === 'report', r.interpretation);
    expect('commit confirms', r.commit.status === 200 && r.commit.body.confirmation === 'Report sent', r.commit);
    const id = r.taskId;
    let t = await task(id);
    expect('P2 security task, assigned to Ana', t.status === 'assigned' && t.assignee_id === ana.id && t.priority === 'P2', { status: t.status, assignee: t.assignee_id });

    const heard = await ana.call('interpret', { text: 'copy, on my way' });
    expect('"copy, on my way" reads as accept on her task', heard.body?.intent?.kind === 'reply' && heard.body.intent.reply === 'accept' && heard.body.intent.taskId === id, heard.body);
    const sent = await ana.call('commit', { interpretation: heard.body });
    expect('commit sends the reply', sent.status === 200 && sent.body.confirmation === 'Sent “Accept”', sent);
    t = await task(id);
    expect('task accepted with an ETA', t.status === 'accepted' && t.eta_at != null, t.status);

    const done = await ana.call('reply', { taskId: id, reply: 'done', note: 'talked him down, mates took him home' });
    expect('done → 200', done.status === 200, done);
    t = await task(id);
    expect('task resolved as done', t.status === 'resolved' && t.resolution === 'done' && t.resolved_at != null, t);
    const kinds = await eventKinds(id);
    expect('events: created, assigned, reply, resolved', sameKinds(kinds, ['created', 'assigned', 'reply', 'resolved']), kinds);
    const ev = await events(id);
    expect('done event keeps the note and actor', ev.some((e) => e.kind === 'resolved' && e.actor_id === ana.id && e.data.note === 'talked him down, mates took him home'), ev);
    expect('every event has text and an actor name', ev.every((e) => e.data.text && e.data.actorName), ev);
    expect('Ana\'s task_assignments row followed her to done', (await assignments(id)).map((a) => `${a.volunteer_id === ana.id}:${a.status}`).join() === 'true:done', await assignments(id));
    const toAna = await messagesFor(id, ana);
    expect('Ana got the task spoken', toAna.length === 1 && toAna[0].kind === 'task' && toAna[0].delivery === 'spoken', toAna);
    const toCam = await messagesFor(id, cam);
    expect('Cam hears where his report went', toCam.length === 1 && /went to Security Liaison\. Ana is on it/.test(toCam[0].body), toCam);
    expect('no lead messages for a report a volunteer finished', (await messagesFor(id, lee)).length === 0 && (await messagesFor(id, mo)).length === 0);
    const [p] = await sql`select z.slug from profiles p join zones z on z.id = p.last_known_zone where p.id = ${ana.id}`;
    expect('finishing moves Ana to the task zone', p?.slug === 'backstage', p);
  }

  // ── 2. Authorisation ──
  section('authorisation');
  let helpTask = '';
  {
    helpTask = (await say(cam, 'Someone stole a phone at the merch tent')).taskId;
    expect('second task goes to Ana again', (await task(helpTask)).assignee_id === ana.id);
    expect('another volunteer cannot act on it (403)', (await ben.call('reply', { taskId: helpTask, reply: 'accept' })).status === 403);
    expect('nor reply to its festival-goer (403)', (await ben.call('guestReply', { taskId: helpTask, text: 'hi' })).status === 403);
    expect('a volunteer cannot use lead commands (403)', (await ana.call('assign', { taskId: helpTask, volunteerId: ben.id })).status === 403);
    const g = await guest();
    expect('a festival-goer cannot use crew commands (403)', (await g.call('reply', { taskId: helpTask, reply: 'done' })).status === 403);
    expect('no session → 401', (await post(null, 'reply', { taskId: helpTask, reply: 'accept' })).status === 401);
    expect('bad body → 400', (await ana.call('reply', { taskId: 'nope', reply: 'accept' })).status === 400);
    expect('unknown task → 404', (await ana.call('reply', { taskId: crypto.randomUUID(), reply: 'accept' })).status === 404);
    const early = await ana.call('reply', { taskId: helpTask, reply: 'done' });
    expect('done before accepting → 409', early.status === 409, early);
    expect('task untouched by the refusals', (await task(helpTask)).status === 'assigned');
  }

  // ── 3. need_help escalates to the lead; the lead sends backup ──
  section('need help → lead → backup');
  {
    await ana.call('reply', { taskId: helpTask, reply: 'accept' });
    const help = await ana.call('reply', { taskId: helpTask, reply: 'need_help', note: 'there are three of them now' });
    expect('need_help → 200', help.status === 200, help);
    let t = await task(helpTask);
    expect('escalated to Lee, the team lead', t.status === 'escalated' && t.escalation?.level === 'lead' && t.escalation?.ownerId === lee.id && t.escalation?.reason === 'there are three of them now', t.escalation);
    expect('Lee is told', (await messagesFor(helpTask, lee)).some((m) => m.kind === 'escalation' && /Ana asked for help/.test(m.body)));
    expect('Ana sees who she asked', (await messagesFor(helpTask, ana)).some((m) => m.kind === 'system' && /Asked Lee for help/.test(m.body)));

    // Two responses at once: one wins, the other finds it already handled.
    const [a, b] = await Promise.all([
      lee.call('respond', { taskId: helpTask, response: { kind: 'backup', volunteerId: ben.id } }),
      mo.call('respond', { taskId: helpTask, response: { kind: 'backup', volunteerId: cam.id } }),
    ]);
    expect('racing responses: one 200, one 409', [a.status, b.status].sort().join() === '200,409', [a, b]);
    t = await task(helpTask);
    const helper = a.status === 200 ? ben : cam;
    expect('backup joins: accepted, one helper', t.status === 'accepted' && t.helper_ids.length === 1 && t.helper_ids[0] === helper.id, { status: t.status, helpers: t.helper_ids });
    expect('the backup is told, spoken', (await messagesFor(helpTask, helper)).some((m) => m.kind === 'backup' && m.delivery === 'spoken'));
    expect('Ana hears who is joining', (await messagesFor(helpTask, ana)).some((m) => m.kind === 'backup' && /is joining you/.test(m.body)));
    expect('a helper cannot escalate (403)', (await helper.call('reply', { taskId: helpTask, reply: 'need_help' })).status === 403);
    const done = await helper.call('reply', { taskId: helpTask, reply: 'done' });
    expect('the helper can finish it for everyone', done.status === 200 && (await task(helpTask)).status === 'resolved', done);
    expect('Ana hears it was finished', (await messagesFor(helpTask, ana)).some((m) => /marked it done/.test(m.body)));
  }

  // ── 4. Festival-goers ──
  section('festival-goers');
  {
    const alex = await guest();
    const sam = await guest();
    const req = await ask(alex, 'The band in the green room needs more water', 'backstage');
    expect('the request became a task', req.stage === 'finding' && !!req.task_id && req.guest_id === alex.id, req);
    const t = await task(req.task_id);
    expect('P3 artist task, straight to Cam', t.priority === 'P3' && t.status === 'assigned' && t.request_id === req.id && t.assignee_id === cam.id, t);
    const mine = await alex.client.from('guest_requests').select('id, task_id');
    expect('the festival-goer reads their request through RLS', mine.data?.length === 1 && mine.data[0].task_id === req.task_id, mine);

    expect('another festival-goer cannot add to it (403)', (await sam.call('guestAddDetail', { requestId: req.id, text: 'lol' })).status === 403);
    expect('nor cancel it (403)', (await sam.call('guestCancel', { requestId: req.id })).status === 403);
    expect('unknown zone → 400', (await sam.call('guestAsk', { text: 'hello', zoneSlug: 'mars' })).status === 400);

    const answered = await ask(sam, 'Where are the toilets?', 'lawn-stage');
    expect('a routine question is answered, no task', answered.stage === 'answered' && !answered.task_id && /Toilets/.test(answered.ai_answer), answered);

    const detail = await alex.call('guestAddDetail', { requestId: req.id, text: 'they want sparkling' });
    expect('a detail is a note, not an escalation', detail.status === 200 && detail.body.escalated === false, detail);
    expect('the volunteer hears the detail', (await messagesFor(t.id, cam)).some((m) => m.kind === 'guest_reply' && /sparkling/.test(m.body)));
    expect('the volunteer can reply to the festival-goer', (await cam.call('guestReply', { taskId: t.id, text: 'Two minutes away' })).status === 200);
    const thread = (await sql`select thread from guest_requests where id = ${req.id}`)[0].thread as { from: string; text: string }[];
    expect('thread: ask, detail, note added, staff reply', thread.map((e) => e.from).join() === 'guest,guest,ai,staff' && thread[3].text === 'Two minutes away', thread);

    expect('the festival-goer cancels', (await alex.call('guestCancel', { requestId: req.id })).status === 200);
    const after = await task(t.id);
    expect('task cancelled, volunteer told', after.status === 'cancelled' && (await messagesFor(t.id, cam)).some((m) => m.kind === 'closed'), after.status);
  }

  // ── 5. P1 proposal auto-assigns through the scheduler; a lead approves another ──
  section('proposals');
  {
    const casey = await guest();
    const req = await ask(casey, 'Someone pulled a weapon by the food stalls', 'food-alley');
    const [p] = await sql`select * from agent_actions where task_id = ${req.task_id}`;
    const t0 = await task(req.task_id);
    expect('P1 task waits on a proposal', t0.priority === 'P1' && t0.status === 'open' && p?.status === 'pending', { task: t0.status, proposal: p?.status });
    expect('auto_assign_at is set from the policy', p.auto_assign_at.getTime() - p.created_at.getTime() === policy.autoAssignMs, p);
    expect('Lee and Mo are asked to approve', (await messagesFor(req.task_id, lee)).some((m) => /^Approve:/.test(m.body)) && (await messagesFor(req.task_id, mo)).some((m) => /^Approve:/.test(m.body)));
    const proposed = await sql`select volunteer_id from task_assignments where task_id = ${req.task_id} and status = 'proposed'`;
    const order = p.payload.volunteerIds as string[];
    expect('candidates recorded as task_assignments, ranked in payload.volunteerIds', proposed.length === order.length && proposed.length > 0 && proposed.every((c) => order.includes(c.volunteer_id)), { proposed, order });
    expect('the AI\'s top pick is on the team', [ana.id, ben.id].includes(order[0]), order);

    const decided = await until('the scheduler to auto-assign', async () => (await sql`select * from agent_actions where id = ${p.id} and status <> 'pending'`)[0], policy.autoAssignMs + 5_000);
    const t = await task(req.task_id);
    expect('proposal executed (auto_assigned) after auto_assign_at', decided.status === 'executed' && decided.decided_by == null && decided.decided_at.getTime() >= p.auto_assign_at.getTime(), decided);
    expect('task assigned to the top pick', t.status === 'assigned' && t.assignee_id === order[0], t);
    expect('assigned event says auto-assigned', (await events(req.task_id)).some((e) => e.kind === 'assigned' && /auto-assigned/.test(e.data.text)));
    const rows = await assignments(req.task_id);
    expect('the pick\'s row is approved, the rest rejected', rows.filter((a) => a.status === 'approved').map((a) => a.volunteer_id).join() === t.assignee_id && rows.every((a) => a.status === 'approved' || a.status === 'rejected'), rows);
    await casey.call('guestCancel', { requestId: req.id });

    const drew = await guest();
    const req2 = await ask(drew, 'There was a theft from a bag near the stage', 'lawn-stage');
    const [p2] = await sql`select * from agent_actions where task_id = ${req2.task_id}`;
    expect('a P2 asks only the lead', (await messagesFor(req2.task_id, lee)).some((m) => /^Approve:/.test(m.body)) && (await messagesFor(req2.task_id, mo)).length === 0);
    const other = p2.payload.volunteerIds[0] === ana.id ? ben : ana;
    const first = other === ana ? ben : ana;
    const ok = await lee.call('approve', { proposalId: p2.id, volunteerId: other.id });
    expect('Lee approves, picking the other volunteer', ok.status === 200, ok);
    const [after] = await sql`select * from agent_actions where id = ${p2.id}`;
    expect('proposal approved by Lee, task to his pick', after.status === 'approved' && after.decided_by === lee.id && (await task(req2.task_id)).assignee_id === other.id, after);
    expect('approving again → 409', (await mo.call('approve', { proposalId: p2.id })).status === 409);

    // Moving a task off someone keeps their row, now reassigned, so their phone still sees the change.
    expect('Lee moves it to the other volunteer', (await lee.call('assign', { taskId: req2.task_id, volunteerId: first.id })).status === 200);
    const moved = await assignments(req2.task_id);
    const statusOf = (who: Person) => moved.filter((a) => a.volunteer_id === who.id).map((a) => a.status).join();
    expect('the first pick\'s row is reassigned, the new owner notified', statusOf(other) === 'reassigned' && statusOf(first) === 'rejected,notified', moved);
    expect('the first pick hears it moved', (await messagesFor(req2.task_id, other)).some((m) => m.kind === 'moved'));
    const still = await other.client.from('tasks').select('id, assignee_id').eq('id', req2.task_id);
    expect('and can still read the task, now someone else\'s', still.data?.length === 1 && still.data[0].assignee_id === first.id, still);
    await drew.call('guestCancel', { requestId: req2.id });
  }

  // ── 6. A silent task nudges once, with commands and ticks racing ──
  section('silent task, racing');
  {
    const id = (await say(cam, 'Big spill by the bins at the end of the food alley')).taskId;
    const open = await task(id);
    expect('vendors has nobody on: the task stays open', open.status === 'open' && open.assignee_id == null, open.status);
    expect('Mo assigns it to Ben', (await mo.call('assign', { taskId: id, volunteerId: ben.id })).status === 200);
    const assignedAt = (await task(id)).assigned_at.getTime();

    // Hammer it from just before the ack deadline until just after: the server's own scheduler, a second
    // scheduler in this process, and commands that all take the world lock.
    const race = async () => Promise.all([
      ...Array.from({ length: 6 }, () => schedulerPass()),
      mo.call('passToCoordinator', { taskId: id }),
      mo.call('arrived', { taskId: id }),
      ben.call('guestReply', { taskId: id, text: 'x' }),
      ben.call('setDuty', { duty: 'on_duty' }),
    ]);
    while (Date.now() < assignedAt + policy.ackTimeoutMs - 300) await sleep(50);
    while (Date.now() < assignedAt + policy.ackTimeoutMs + 1_500) await race();
    let kinds = await eventKinds(id);
    expect('exactly one nudge', count(kinds, 'nudged') === 1, kinds);
    const nudges = (await messagesFor(id, ben)).filter((m) => m.kind === 'nudge');
    expect('exactly one nudge message', nudges.length === 1, nudges);

    const nudgedAt = (await task(id)).last_nudge_at.getTime();
    while (Date.now() < nudgedAt + policy.nudgeGapMs - 300) await sleep(50);
    while (Date.now() < nudgedAt + policy.nudgeGapMs + 1_500) await race();
    kinds = await eventKinds(id);
    expect('then exactly one lead alert', count(kinds, 'lead_alerted') === 1 && count(kinds, 'nudged') === 1, kinds);
    const quiet = (await messagesFor(id, mo)).filter((m) => /went quiet/.test(m.body));
    expect('Mo told once (vendors has no lead)', quiet.length === 1, quiet);

    const fine = await mo.call('respond', { taskId: id, response: { kind: 'carry_on' } });
    const t = await task(id);
    expect('"They\'re fine" clears it', fine.status === 200 && t.lead_alerted_at == null && t.nudge_count === 0, { status: fine.status, alerted: t.lead_alerted_at });
    await ben.call('reply', { taskId: id, reply: 'accept' });
    expect('and Ben can finish it', (await ben.call('reply', { taskId: id, reply: 'done' })).status === 200);
  }

  // ── 7. Messages and duty ──
  section('messages and duty');
  {
    expect('broadcast to security', (await lee.call('broadcast', { body: `check-commands ${run}: water break`, scope: { teamSlug: 'security' } })).status === 200);
    const got = await sql`select d.recipient_id from messages m join message_deliveries d on d.message_id = m.id where m.body = ${`check-commands ${run}: water break`}`;
    expect('one delivery per on-duty security volunteer', got.length === 2 && got.every((g) => [ana.id, ben.id].includes(g.recipient_id)), got);
    expect('sendDirect', (await mo.call('sendDirect', { volunteerId: cam.id, body: `check-commands ${run}: see me` })).status === 200);
    const [dm] = await sql`select m.id, m.sender_id, m.kind, d.read_at from messages m join message_deliveries d on d.message_id = m.id where m.body = ${`check-commands ${run}: see me`}`;
    expect('direct message from Mo', dm?.sender_id === mo.id && dm.kind === 'direct' && dm.read_at == null, dm);
    expect('only the recipient can mark it read', (await ana.call('markRead', { messageIds: [dm.id] })).status === 200 && (await sql`select read_at from message_deliveries where message_id = ${dm.id}`)[0].read_at == null);
    await cam.call('markRead', { messageIds: [dm.id] });
    expect('markRead sets read_at for the caller', (await sql`select read_at from message_deliveries where message_id = ${dm.id}`)[0].read_at != null);
    expect('setDuty', (await cam.call('setDuty', { duty: 'on_break' })).status === 200 && (await sql`select status from profiles where id = ${cam.id}`)[0].status === 'on_break');
  }
} catch (e) {
  failures++;
  console.log('FAIL', e instanceof Error ? e.message : e);
} finally {
  // Same lock as the server, so the scheduler can't write to a task halfway through its removal.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('moloop:world'))`;
    const ids = [...tracked].filter(Boolean);
    const reports = (await tx`select report_id from tasks where id = any(${ids}::uuid[])`).map((r) => r.report_id);
    await tx`delete from messages where task_id = any(${ids}::uuid[]) or body like ${`check-commands ${run}:%`}`;
    await tx`delete from agent_actions where task_id = any(${ids}::uuid[])`;
    await tx`delete from guest_requests where guest_id = any(${guestIds}::uuid[])`;
    await tx`delete from tasks where id = any(${ids}::uuid[])`;
    await tx`delete from reports where id = any(${reports}::uuid[])`;
  });
  await Promise.all([...guestIds, ...crewIds].map((id) => admin.auth.admin.deleteUser(id)));
  await sql.end();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

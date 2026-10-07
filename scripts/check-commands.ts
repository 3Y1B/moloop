/**
 * Drives the running server over HTTP as real sessions (seeded crew via email OTP, festival-goers via
 * anonymous sign-in) and checks what each command writes. Needs the server on fast timings:
 *
 *   POLICY_SCALE=0.05 POLICY_AUTO_ASSIGN_MS=3000 SCHEDULER_MS=500 npm run server
 *   npm run check:commands            (SERVER_URL defaults to http://127.0.0.1:8787)
 *
 * Cleans up what it creates, and puts crew duty and zones back.
 */
import { createClient } from '@supabase/supabase-js';
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

// ── server and sessions ──

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

const { data: users } = await admin.auth.admin.listUsers();
type Person = { id: string; name: string; call: (name: string, body?: unknown) => Promise<Res> };

async function crew(handle: string): Promise<Person> {
  const email = `${handle}@moloop.test`;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = createClient(url, publishable, opts);
  const { data: v, error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
  const token = v.session!.access_token;
  return { id: users.users.find((u) => u.email === email)!.id, name: handle, call: (n, b = {}) => post(token, n, b) };
}

const guestIds: string[] = [];
async function guest(name: string) {
  const client = createClient(url, publishable, opts);
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  guestIds.push(data.user!.id);
  const token = data.session!.access_token;
  return { id: data.user!.id, name, client, call: (n: string, b: unknown = {}) => post(token, n, b) };
}

const [mo, jordan, priya, tom, linh, kai] = await Promise.all(['mo', 'jordan', 'priya', 'tom', 'linh', 'kai'].map(crew));
const crewIds = [mo, jordan, priya, tom, linh, kai].map((p) => p.id);

// The checks know who should get each task, so the crew must start free. The local stack is shared:
// wait a while for anyone else's run to finish rather than fail on their data.
const busy = () => sql`
  select t.title, p.full_name from tasks t join profiles p on p.id = t.assignee_id or p.id = any(t.helper_ids)
  where t.status in ('queued', 'assigned', 'accepted', 'in_progress', 'escalated') and p.id = any(${crewIds}::uuid[])`;
for (let waited = 0; (await busy()).length; waited += 2_000) {
  if (waited >= 60_000) throw new Error(`Crew still busy with other tasks: ${JSON.stringify(await busy())}`);
  if (!waited) console.log('waiting for crew to be free…', (await busy()).map((b) => `${b.full_name}: ${b.title}`).join('; '));
  await sleep(2_000);
}
const before = await sql`select id, status, last_known_zone from profiles where id = any(${crewIds}::uuid[])`;
if (before.some((p) => p.status !== 'active')) throw new Error('Run with every seeded crew member on duty (profiles.status = active)');

// ── reading what the server wrote ──

const tracked = new Set<string>();
const task = async (id: string) => (await sql`select * from tasks where id = ${id}`)[0];
const eventKinds = async (id: string) => (await sql`select kind from task_events where task_id = ${id} order by created_at`).map((e) => e.kind as string);
const events = (id: string) => sql`select kind, actor_id, data from task_events where task_id = ${id} order by created_at`;
const messagesFor = (taskId: string, who: Person) => sql`
  select m.kind, m.body, d.delivery from messages m join message_deliveries d on d.message_id = m.id
  where m.task_id = ${taskId} and d.recipient_id = ${who.id} order by m.created_at`;
const count = (xs: string[], k: string) => xs.filter((x) => x === k).length;
const sameKinds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** The newest live task reported by `who` through commit, or assigned to `who`. */
async function newestTaskReportedBy(who: Person) {
  const [t] = await sql`select t.id from tasks t join reports r on r.id = t.report_id where r.reporter_id = ${who.id} order by t.created_at desc limit 1`;
  if (t) tracked.add(t.id);
  return t?.id as string | undefined;
}
async function report(who: Person, text: string) {
  const i = await who.call('interpret', { text });
  const res = await who.call('commit', { interpretation: i.body });
  return { interpretation: i, commit: res, taskId: await newestTaskReportedBy(who) };
}

try {
  // ── 1. A volunteer accepts and completes their task ──
  section('volunteer accepts and completes');
  {
    const r = await report(kai, 'Someone hurt their ankle by the barrier, needs first aid');
    expect('report reads as a report', r.interpretation.status === 200 && r.interpretation.body.intent.kind === 'report', r.interpretation);
    expect('commit confirms', r.commit.status === 200 && r.commit.body.confirmation === 'Report sent', r.commit);
    const id = r.taskId!;
    let t = await task(id);
    expect('task assigned to a free first aider (Priya)', t.status === 'assigned' && t.assignee_id === priya.id && t.priority === 'P2', { status: t.status, assignee: t.assignee_id });

    const heard = await priya.call('interpret', { text: 'copy, on my way' });
    expect('"copy, on my way" reads as accept on her task', heard.body?.intent?.kind === 'reply' && heard.body.intent.reply === 'accept' && heard.body.intent.taskId === id, heard.body);
    const sent = await priya.call('commit', { interpretation: heard.body });
    expect('commit sends the reply', sent.status === 200 && sent.body.confirmation === 'Sent “Accept”', sent);
    t = await task(id);
    expect('task accepted with an ETA', t.status === 'accepted' && t.eta_at != null, t.status);

    const done = await priya.call('reply', { taskId: id, reply: 'done', note: 'strapped it, he walked off' });
    expect('done → 200', done.status === 200, done);
    t = await task(id);
    expect('task resolved as done', t.status === 'resolved' && t.resolution === 'done' && t.resolved_at != null, t);
    const kinds = await eventKinds(id);
    expect('events: created, assigned, reply, resolved', sameKinds(kinds, ['created', 'assigned', 'reply', 'resolved']), kinds);
    const ev = await events(id);
    expect('done event keeps the note and actor', ev.some((e) => e.kind === 'resolved' && e.actor_id === priya.id && e.data.note === 'strapped it, he walked off'), ev);
    const toPriya = await messagesFor(id, priya);
    expect('Priya got the task spoken', toPriya.length === 1 && toPriya[0].kind === 'task' && toPriya[0].delivery === 'spoken', toPriya);
    const toKai = await messagesFor(id, kai);
    expect('Kai hears where his report went', toKai.length === 1 && /went to First Aid & Heat\. Priya is on it/.test(toKai[0].body), toKai);
    const toLead = await messagesFor(id, jordan);
    expect('no lead messages for a routine report', toLead.length === 0, toLead);
    const [p] = await sql`select z.slug from profiles p join zones z on z.id = p.last_known_zone where p.id = ${priya.id}`;
    expect('finishing moves Priya to the task zone', p?.slug === 'gate-a', p);
  }

  // ── 2. Authorisation ──
  section('authorisation');
  let helpTask = '';
  {
    const r = await report(kai, 'A kid fell off the fence and is bleeding from the knee');
    helpTask = r.taskId!;
    const t = await task(helpTask);
    expect('second task goes to Priya again', t.assignee_id === priya.id, t.assignee_id);
    const theirs = await tom.call('reply', { taskId: helpTask, reply: 'accept' });
    expect('another volunteer cannot act on it (403)', theirs.status === 403, theirs);
    expect('nor reply to its festival-goer (403)', (await tom.call('guestReply', { taskId: helpTask, text: 'hi' })).status === 403);
    expect('a volunteer cannot use lead commands (403)', (await priya.call('assign', { taskId: helpTask, volunteerId: tom.id })).status === 403);
    const g = await guest('nosy');
    expect('a festival-goer cannot use crew commands (403)', (await g.call('reply', { taskId: helpTask, reply: 'done' })).status === 403);
    expect('no session → 401', (await post(null, 'reply', { taskId: helpTask, reply: 'accept' })).status === 401);
    expect('bad body → 400', (await priya.call('reply', { taskId: 'nope', reply: 'accept' })).status === 400);
    expect('unknown task → 404', (await priya.call('reply', { taskId: crypto.randomUUID(), reply: 'accept' })).status === 404);
    const early = await priya.call('reply', { taskId: helpTask, reply: 'done' });
    expect('done before accepting → 409', early.status === 409, early);
    expect('task untouched by the refusals', (await task(helpTask)).status === 'assigned');
  }

  // ── 3. need_help escalates to the lead; the lead sends backup ──
  section('need help → lead → backup');
  {
    await priya.call('reply', { taskId: helpTask, reply: 'accept' });
    const help = await priya.call('reply', { taskId: helpTask, reply: 'need_help', note: 'he’s getting worse' });
    expect('need_help → 200', help.status === 200, help);
    let t = await task(helpTask);
    expect('escalated to Jordan, the team lead', t.status === 'escalated' && t.escalation?.level === 'lead' && t.escalation?.ownerId === jordan.id && t.escalation?.reason === 'he’s getting worse', t.escalation);
    const toJordan = await messagesFor(helpTask, jordan);
    expect('Jordan is told', toJordan.some((m) => m.kind === 'escalation' && /Priya asked for help/.test(m.body)), toJordan);
    expect('Priya sees who she asked', (await messagesFor(helpTask, priya)).some((m) => m.kind === 'system' && /Asked Jordan for help/.test(m.body)));

    // Two responses at once: one wins, the other finds it already handled.
    const [a, b] = await Promise.all([
      jordan.call('respond', { taskId: helpTask, response: { kind: 'backup', volunteerId: tom.id } }),
      mo.call('respond', { taskId: helpTask, response: { kind: 'backup', volunteerId: kai.id } }),
    ]);
    expect('racing responses: one 200, one 409', [a.status, b.status].sort().join() === '200,409', [a, b]);
    t = await task(helpTask);
    const helper = a.status === 200 ? tom : kai;
    expect('backup joins: accepted, one helper', t.status === 'accepted' && t.helper_ids.length === 1 && t.helper_ids[0] === helper.id, { status: t.status, helpers: t.helper_ids });
    expect('the backup is told, spoken', (await messagesFor(helpTask, helper)).some((m) => m.kind === 'backup' && m.delivery === 'spoken'));
    expect('Priya hears who is joining', (await messagesFor(helpTask, priya)).some((m) => m.kind === 'backup' && /is joining you/.test(m.body)));
    const done = await helper.call('reply', { taskId: helpTask, reply: 'done' });
    expect('the helper can finish it for everyone', done.status === 200 && (await task(helpTask)).status === 'resolved', done);
    expect('Priya hears it was finished', (await messagesFor(helpTask, priya)).some((m) => /marked it done/.test(m.body)));
  }

  // ── 4. Festival-goers ──
  section('festival-goers');
  {
    const alex = await guest('alex');
    const sam = await guest('sam');
    const ask = await alex.call('guestAsk', { text: 'Can someone bring blister plasters and sunscreen? We’re at the Info Tent', zoneSlug: 'info-tent' });
    expect('guestAsk → requestId', ask.status === 200 && typeof ask.body.requestId === 'string', ask);
    const rid = ask.body.requestId as string;
    const req = await until('the request to be understood', async () => (await sql`select * from guest_requests where id = ${rid} and stage <> 'understanding'`)[0]);
    tracked.add(req.task_id);
    expect('request became a task', req.stage === 'finding' && !!req.task_id && req.guest_id === alex.id, req);
    const t = await task(req.task_id);
    expect('P3 first-aid task, straight to a volunteer', t.priority === 'P3' && t.status === 'assigned' && t.request_id === rid && [priya.id, tom.id].includes(t.assignee_id), t);
    const mine = await alex.client.from('guest_requests').select('id, task_id');
    expect('the festival-goer reads their request through RLS', mine.data?.length === 1 && mine.data[0].task_id === req.task_id, mine);

    expect('another festival-goer cannot add to it (403)', (await sam.call('guestAddDetail', { requestId: rid, text: 'lol' })).status === 403);
    expect('nor cancel it (403)', (await sam.call('guestCancel', { requestId: rid })).status === 403);
    expect('unknown zone → 400', (await sam.call('guestAsk', { text: 'hello', zoneSlug: 'mars' })).status === 400);

    const q = await sam.call('guestAsk', { text: 'Where are the toilets?', zoneSlug: 'lawn-stage' });
    const answered = await until('the question to be answered', async () => (await sql`select * from guest_requests where id = ${q.body.requestId} and stage <> 'understanding'`)[0]);
    expect('a routine question is answered, no task', answered.stage === 'answered' && !answered.task_id && /Toilets/.test(answered.ai_answer), answered);

    const vol = t.assignee_id === priya.id ? priya : tom;
    const detail = await alex.call('guestAddDetail', { requestId: rid, text: 'she has a red hat' });
    expect('a detail is a note, not an escalation', detail.status === 200 && detail.body.escalated === false, detail);
    expect('the volunteer hears the detail', (await messagesFor(t.id, vol)).some((m) => m.kind === 'guest_reply' && /red hat/.test(m.body)));
    expect('the volunteer can reply to the festival-goer', (await vol.call('guestReply', { taskId: t.id, text: 'Two minutes away' })).status === 200);
    const thread = (await sql`select thread from guest_requests where id = ${rid}`)[0].thread as { from: string; text: string }[];
    expect('thread: ask, detail, note added, staff reply', thread.map((e) => e.from).join() === 'guest,guest,ai,staff' && thread[3].text === 'Two minutes away', thread);

    expect('the festival-goer cancels', (await alex.call('guestCancel', { requestId: rid })).status === 200);
    const after = await task(t.id);
    expect('task cancelled, volunteer told', after.status === 'cancelled' && (await messagesFor(t.id, vol)).some((m) => m.kind === 'closed'), after.status);
  }

  // ── 5. P1 proposal auto-assigns through the scheduler; a lead approves another ──
  section('proposals');
  {
    const casey = await guest('casey');
    const ask = await casey.call('guestAsk', { text: 'My friend collapsed and isn’t responding, front left of the Track Stage', zoneSlug: 'river-stage' });
    const req = await until('the P1 to be triaged', async () => (await sql`select * from guest_requests where id = ${ask.body.requestId} and task_id is not null`)[0]);
    tracked.add(req.task_id);
    const [p] = await sql`select * from agent_actions where task_id = ${req.task_id}`;
    const t0 = await task(req.task_id);
    expect('P1 task waits on a proposal', t0.priority === 'P1' && t0.status === 'open' && p?.status === 'pending', { task: t0.status, proposal: p?.status });
    expect('auto_assign_at is set from the policy', Math.abs(p.auto_assign_at.getTime() - p.created_at.getTime() - policy.autoAssignMs) < 50, p);
    expect('Jordan and Mo are asked to approve', (await messagesFor(req.task_id, jordan)).some((m) => /^Approve:/.test(m.body)) && (await messagesFor(req.task_id, mo)).some((m) => /^Approve:/.test(m.body)));
    const candidates = (await sql`select volunteer_id from task_assignments where task_id = ${req.task_id} and status = 'proposed'`).length;
    expect('candidates recorded as task_assignments', candidates === p.payload.candidates.length && candidates > 0, candidates);

    const decided = await until('the scheduler to auto-assign', async () => (await sql`select * from agent_actions where id = ${p.id} and status <> 'pending'`)[0], policy.autoAssignMs + 5_000);
    const t = await task(req.task_id);
    expect('proposal executed (auto_assigned) after auto_assign_at', decided.status === 'executed' && decided.decided_at.getTime() >= p.auto_assign_at.getTime() && decided.payload.volunteerId === t.assignee_id, decided);
    expect('task assigned to the top pick', t.status === 'assigned' && t.assignee_id === p.payload.candidates[0].volunteerId, t);
    expect('assigned event says auto-assigned', (await events(req.task_id)).some((e) => e.kind === 'assigned' && /auto-assigned/.test(e.data.text)));
    expect('the pick is task_assignments approved, the rest rejected', (await sql`select count(*)::int as n from task_assignments where task_id = ${req.task_id} and status = 'approved'`)[0].n === 1);
    await casey.call('guestCancel', { requestId: ask.body.requestId });

    // Welfare has no lead, so Mo approves, picking someone other than the AI.
    const drew = await guest('drew');
    const ask2 = await drew.call('guestAsk', { text: 'Someone is harassing people near the food stalls and I feel unsafe', zoneSlug: 'food-alley' });
    const req2 = await until('the P2 to be triaged', async () => (await sql`select * from guest_requests where id = ${ask2.body.requestId} and task_id is not null`)[0]);
    tracked.add(req2.task_id);
    const [p2] = await sql`select * from agent_actions where task_id = ${req2.task_id}`;
    expect('Mo is asked when the team has no lead', (await messagesFor(req2.task_id, mo)).some((m) => /^Approve:/.test(m.body)));
    const ok = await mo.call('approve', { proposalId: p2.id, volunteerId: linh.id });
    expect('Mo approves with Linh', ok.status === 200, ok);
    const [after] = await sql`select * from agent_actions where id = ${p2.id}`;
    expect('proposal approved by Mo, task to Linh', after.status === 'approved' && after.decided_by === mo.id && (await task(req2.task_id)).assignee_id === linh.id, after);
    expect('approving again → 409', (await jordan.call('approve', { proposalId: p2.id })).status === 409);
    await drew.call('guestCancel', { requestId: ask2.body.requestId });
  }

  // ── 6. A silent task nudges once, with commands and ticks racing ──
  section('silent task, racing');
  {
    const r = await report(kai, 'Big spill by the bins at the end of the food alley');
    const id = r.taskId!;
    expect('nobody on that team: task stays open', (await task(id)).status === 'open' && (await task(id)).assignee_id == null);
    expect('Mo assigns it to Linh', (await mo.call('assign', { taskId: id, volunteerId: linh.id })).status === 200);
    const assignedAt = (await task(id)).assigned_at.getTime();

    // Hammer it from just before the ack deadline until just after: the server's own scheduler, a second
    // scheduler in this process, and commands that all take the world lock.
    const race = async () => Promise.all([
      ...Array.from({ length: 6 }, () => schedulerPass()),
      mo.call('passToCoordinator', { taskId: id }),
      mo.call('arrived', { taskId: id }),
      linh.call('guestReply', { taskId: id, text: 'x' }),
      linh.call('setDuty', { duty: 'on_duty' }),
      linh.call('markRead', { messageIds: [] }),
    ]);
    while (Date.now() < assignedAt + policy.ackTimeoutMs - 300) await sleep(50);
    while (Date.now() < assignedAt + policy.ackTimeoutMs + 1_500) await race();
    let kinds = await eventKinds(id);
    expect('exactly one nudge', count(kinds, 'nudged') === 1, kinds);
    const nudges = (await messagesFor(id, linh)).filter((m) => m.kind === 'nudge');
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
    expect('"They\'re fine" clears it', fine.status === 200 && t.lead_alerted_at == null && t.nudge_count === 0, { status: fine.status, t: t.lead_alerted_at });
    await linh.call('reply', { taskId: id, reply: 'accept' });
    expect('and Linh can finish it', (await linh.call('reply', { taskId: id, reply: 'done' })).status === 200);
  }

  // ── 7. Messages and duty ──
  section('messages and duty');
  {
    expect('broadcast to first aid', (await jordan.call('broadcast', { body: 'check-commands: water break', scope: { teamSlug: 'first-aid' } })).status === 200);
    const got = await sql`select d.recipient_id from messages m join message_deliveries d on d.message_id = m.id where m.body = 'check-commands: water break'`;
    expect('one delivery per on-duty first aider', got.length === 2 && got.every((g) => [priya.id, tom.id].includes(g.recipient_id)), got);
    expect('sendDirect', (await mo.call('sendDirect', { volunteerId: kai.id, body: 'check-commands: see me' })).status === 200);
    const [dm] = await sql`select m.id, m.sender_id, d.read_at from messages m join message_deliveries d on d.message_id = m.id where m.body = 'check-commands: see me'`;
    expect('direct message from Mo', dm?.sender_id === mo.id && dm.read_at == null, dm);
    await kai.call('markRead', { messageIds: [dm.id] });
    expect('markRead sets read_at for the caller', (await sql`select read_at from message_deliveries where message_id = ${dm.id}`)[0].read_at != null);
    expect('setDuty', (await kai.call('setDuty', { duty: 'on_break' })).status === 200 && (await sql`select status from profiles where id = ${kai.id}`)[0].status === 'on_break');
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
    await tx`delete from messages where task_id = any(${ids}::uuid[]) or body like 'check-commands:%'`;
    await tx`delete from agent_actions where task_id = any(${ids}::uuid[])`;
    await tx`delete from guest_requests where guest_id = any(${guestIds}::uuid[])`;
    await tx`delete from tasks where id = any(${ids}::uuid[])`;
    await tx`delete from reports where id = any(${reports}::uuid[])`;
    for (const p of before) await tx`update profiles set status = ${p.status}, last_known_zone = ${p.last_known_zone} where id = ${p.id}`;
  });
  await Promise.all(guestIds.map((id) => admin.auth.admin.deleteUser(id)));
  await sql.end();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

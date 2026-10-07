/**
 * Voice in and out against the running server, as real sessions (docs/PLAN-LIVE.md, phase 4). Needs a speech server
 * (Spark, or SPEECH_BASE_URL) and a server with live models on real timings, so a proposal waits for Mo instead of
 * auto-assigning. Run both with the same env:
 *
 *   USE_LIVE_MODELS=1 npm run server
 *   npm run voice:check
 *
 * The clips are the speech server's TTS of a few lines, sent up as a phone would send a hold:
 *
 *  1. A volunteer reports a fight by voice: heard, the clip kept, and the report goes to a teammate, its clip attached.
 *  2. That teammate is free, so their new task is spoken: the brief's audio lands on their delivery, and only they can
 *     play it. (Normally our security volunteer; if triage picks another team, a seeded volunteer gets it.)
 *  3. They say "on my way", which accepts the task hands-free.
 *  4. A festival-goer says someone collapsed by the food stalls: a P1 proposal for Mo, with the clip on the report.
 *     Mo approves; the first-aider hears it.
 *
 * It brings its own crew (security, artist liaison and first aid) and removes everything it made, clips included.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import { speak } from '../src/server/models/speech';

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
async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// ── server ──

type Health = { policy: { autoAssignMs: number }; speech?: { transcribe: boolean; briefs: boolean } };
const health = (await fetch(`${server}/health`).then((r) => r.json()).catch(() => null)) as Health | null;
if (!health) throw new Error(`No server at ${server}. Start it with: USE_LIVE_MODELS=1 npm run server`);
if (!health.speech?.transcribe || !health.speech.briefs) throw new Error('Voice is off on this server: set the Spark key and USE_LIVE_MODELS=1');
if (health.policy.autoAssignMs < 15_000) throw new Error('The server auto-assigns too fast for Mo to approve: restart it on real timings');

// ── clips: what a phone would send ──

async function clip(text: string): Promise<File> {
  return new File([await speak(text)], 'clip.mp3', { type: 'audio/mpeg' });
}

// ── people ──

type Res = { status: number; body: any };
type Person = { id: string; client: SupabaseClient; call: (name: string, body?: unknown) => Promise<Res>; hear: (f: File) => Promise<Res & { ms: number }> };

function person(id: string, client: SupabaseClient, token: string): Person {
  const auth = { authorization: `Bearer ${token}` };
  return {
    id, client,
    call: async (name, body = {}) => {
      const res = await fetch(`${server}/api/${name}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    hear: async (file) => {
      const form = new FormData();
      form.append('audio', file);
      const t0 = Date.now();
      const res = await fetch(`${server}/api/transcribe`, { method: 'POST', headers: auth, body: form });
      return { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - t0 };
    },
  };
}

async function signIn(email: string, id: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = createClient(url, publishable, opts);
  const { data: v, error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
  return person(id, client, v.session!.access_token);
}

const run = Date.now().toString(36);
const crewIds: string[] = [];
const guestIds: string[] = [];
const idOf = async (table: 'teams' | 'zones', slug: string) => (await sql`select id from ${sql(table)} where slug = ${slug}`)[0].id as string;

async function hire(handle: string, name: string, team: string, zone: string) {
  const email = `voice-${run}-${handle}@moloop.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  crewIds.push(data.user.id);
  await sql`insert into profiles (id, full_name, role, team_id, status, last_known_zone)
    values (${data.user.id}, ${name}, 'volunteer', ${await idOf('teams', team)}, 'active', ${await idOf('zones', zone)})`;
  return signIn(email, data.user.id);
}

async function guest() {
  const client = createClient(url, publishable, opts);
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  guestIds.push(data.user!.id);
  return person(data.user!.id, client, data.session!.access_token);
}

const moUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === 'mo@moloop.test');
if (!moUser) throw new Error('Seed the crew first: npm run db:seed');
const mo = await signIn('mo@moloop.test', moUser.id);
const sam = await hire('sam', 'Sam Voice', 'security', 'gate-b');
const rio = await hire('rio', 'Rio Voice', 'artist', 'backstage');
const fay = await hire('fay', 'Fay Voice', 'first-aid', 'food-alley');

/** Whoever the server picked, signed in: one of ours, or (if triage chose another team) someone seeded. */
async function as(id: string): Promise<Person> {
  const ours = [sam, rio, fay].find((p) => p.id === id);
  if (ours) return ours;
  const { data } = await admin.auth.admin.getUserById(id);
  return signIn(data.user!.email!, id);
}

const tracked = new Set<string>();
const kept = async (path: string) => !(await admin.storage.from('voice').download(path)).error;

/** Waits for the spoken version of `who`'s message on a task, then plays it back as them. */
async function brief(who: Person, taskId: string, since: number) {
  const row = await until(`the brief's audio for ${who.id}`, async () => (await sql`
    select d.audio_path, d.delivery, m.body from message_deliveries d join messages m on m.id = d.message_id
    where d.recipient_id = ${who.id} and m.task_id = ${taskId} and d.delivery = 'spoken' and d.audio_path is not null`)[0]);
  const ms = Date.now() - since;
  const { data, error } = await who.client.storage.from('speech').createSignedUrl(row.audio_path, 60);
  const audio = data ? await fetch(data.signedUrl) : null;
  const bytes = audio?.ok ? (await audio.arrayBuffer()).byteLength : 0;
  return { row, ms, error, type: audio?.headers.get('content-type'), bytes };
}

try {
  // ── 1. A volunteer reports by voice ──
  section('volunteer reports by voice');
  const fight = await rio.hear(await clip('There’s a fight starting by Gate B, two guys shoving each other.'));
  console.log(`     heard in ${fight.ms} ms: ${JSON.stringify(fight.body?.text)}`);
  expect('transcribed', fight.status === 200 && /fight/i.test(fight.body.text), fight);
  expect('clip kept under the speaker', typeof fight.body?.clip === 'string' && fight.body.clip.startsWith(`${rio.id}/`) && await kept(fight.body.clip), fight.body);

  const i = await rio.call('interpret', { text: fight.body.text });
  expect('interpreted as a report', i.status === 200 && i.body.intent.kind === 'report', i.body);
  const sentAt = Date.now();
  const res = await rio.call('commit', { interpretation: { ...i.body, clips: [fight.body.clip] } });
  expect('committed', res.status === 200, res);
  const [t] = await sql`
    select t.id, t.priority, t.assignee_id, tm.slug as team, r.voice_clips from tasks t
    join reports r on r.id = t.report_id join teams tm on tm.id = t.team_id
    where r.reporter_id = ${rio.id} order by t.created_at desc limit 1`;
  if (t) tracked.add(t.id);
  console.log(`     triaged ${t?.priority} for ${t?.team}`);
  expect('report went to a free volunteer', !!t?.assignee_id && t.assignee_id !== rio.id, t);
  expect('report keeps its clip', JSON.stringify(t?.voice_clips) === JSON.stringify([fight.body.clip]), t?.voice_clips);

  // ── 2. The spoken brief ──
  section('spoken brief');
  const owner = await as(t.assignee_id);
  const b = await brief(owner, t.id, sentAt);
  console.log(`     audio ${b.ms} ms after commit: ${JSON.stringify(b.row.body)}`);
  expect('the assignee can play it', !b.error && b.type === 'audio/mpeg' && b.bytes > 2_000, { error: b.error?.message, type: b.type, bytes: b.bytes });
  const { error: theirs } = await rio.client.storage.from('speech').createSignedUrl(b.row.audio_path, 60);
  const { data: listed } = await rio.client.storage.from('speech').list(owner.id);
  expect('nobody else can', !!theirs || !listed?.length, { theirs: theirs?.message, listed: listed?.length });

  // ── 3. Hands-free reply ──
  section('hands-free reply');
  const omw = await owner.hear(await clip('Copy, on my way.'));
  console.log(`     heard in ${omw.ms} ms: ${JSON.stringify(omw.body?.text)}`);
  const reply = await owner.call('interpret', { text: omw.body?.text ?? '' });
  expect('"on my way" accepts the task', reply.body?.intent?.kind === 'reply' && reply.body.intent.reply === 'accept' && reply.body.intent.taskId === t.id, reply.body);
  await owner.call('commit', { interpretation: { ...reply.body, clips: [omw.body.clip] } });
  expect('task accepted', (await sql`select status from tasks where id = ${t.id}`)[0].status === 'accepted');

  // ── 4. Festival-goer: someone collapsed ──
  section('festival-goer, P1');
  const g = await guest();
  const fell = await g.hear(await clip('There’s a guy who’s collapsed by the food stalls.'));
  console.log(`     heard in ${fell.ms} ms: ${JSON.stringify(fell.body?.text)}`);
  expect('transcribed', fell.status === 200 && /collapse/i.test(fell.body.text), fell);
  expect('someone else’s clip is refused', (await g.call('guestAsk', { text: fell.body.text, zoneSlug: 'food-alley', clips: [fight.body.clip] })).status === 403);
  const ask = await g.call('guestAsk', { text: fell.body.text, zoneSlug: 'food-alley', clips: [fell.body.clip] });
  expect('asked', ask.status === 200, ask);
  const req = await until('the request to be understood', async () =>
    (await sql`select * from guest_requests where id = ${ask.body.requestId} and stage <> 'understanding'`)[0]);
  if (req.task_id) tracked.add(req.task_id);
  const [p1] = await sql`
    select t.priority, tm.slug as team, r.voice_clips from tasks t join reports r on r.id = t.report_id join teams tm on tm.id = t.team_id
    where t.id = ${req.task_id}`;
  expect('P1 for first aid', p1?.priority === 'P1' && p1.team === 'first-aid', p1);
  expect('the request and its report keep the clip', JSON.stringify(req.voice_clips) === JSON.stringify([fell.body.clip])
    && JSON.stringify(p1?.voice_clips) === JSON.stringify([fell.body.clip]), { request: req.voice_clips, report: p1?.voice_clips });
  const [proposal] = await sql`select id from agent_actions where task_id = ${req.task_id} and status = 'pending'`;
  expect('a proposal waits for Mo', !!proposal);

  const approvedAt = Date.now();
  expect('Mo sends Fay', (await mo.call('approve', { proposalId: proposal.id, volunteerId: fay.id })).status === 200);
  const fb = await brief(fay, req.task_id, approvedAt);
  console.log(`     audio ${fb.ms} ms after approval: ${JSON.stringify(fb.row.body)}`);
  expect('Fay hears it', !fb.error && fb.bytes > 2_000, { error: fb.error?.message, bytes: fb.bytes });

  section('bad input');
  expect('no file → 400', (await fetch(`${server}/api/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${(await g.client.auth.getSession()).data.session!.access_token}` }, body: new FormData() })).status === 400);
} catch (e) {
  failures++;
  console.log('FAIL', e instanceof Error ? e.message : e);
} finally {
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
  for (const bucket of ['voice', 'speech']) {
    for (const id of [...crewIds, ...guestIds]) {
      const { data } = await admin.storage.from(bucket).list(id);
      if (data?.length) await admin.storage.from(bucket).remove(data.map((f) => `${id}/${f.name}`));
    }
  }
  await Promise.all([...guestIds, ...crewIds].map((id) => admin.auth.admin.deleteUser(id)));
  await sql.end();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

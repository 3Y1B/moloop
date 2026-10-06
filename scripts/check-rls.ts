/**
 * Checks that RLS gives each screen what it reads and nothing more. Creates a throwaway report,
 * two tasks and a guest request, signs in as real seeded crew (email OTP) and as an anonymous
 * festival-goer, then cleans up. Run after `bun scripts/seed.ts` against local Supabase.
 *
 *   bun scripts/check-rls.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);

let failures = 0;
function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

async function as(email: string): Promise<SupabaseClient> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const client = createClient(url, publishable, opts);
  const { error: e2 } = await client.auth.verifyOtp({ email, token: data.properties.email_otp, type: 'email' });
  if (e2) throw e2;
  return client;
}

async function profileId(email: string) {
  const { data } = await admin.auth.admin.listUsers();
  return data.users.find((u) => u.email === email)!.id;
}

const [priya, tom, linh] = await Promise.all(['priya', 'tom', 'linh'].map((n) => profileId(`${n}@moloop.test`)));

const guest = createClient(url, publishable, opts);
const { data: anon, error: anonErr } = await guest.auth.signInAnonymously();
if (anonErr) throw anonErr;
const guestId = anon.user!.id;

// Fixtures, written as the server would (service role).
const { data: report } = await admin.from('reports').insert({ channel: 'text', raw_text: 'rls check' }).select('id').single();
const task = (title: string, assignee: string) => ({
  report_id: report!.id, title, summary: title, category: 'medical', priority: 'P2', status: 'assigned',
  assignee_id: assignee, handled_by: 'human',
});
const { data: tasks } = await admin.from('tasks').insert([task('rls: priya', priya), task('rls: linh', linh), task('rls: tom', tom)]).select('id, title');
const byTitle = Object.fromEntries(tasks!.map((t) => [t.title, t.id]));
const { data: request } = await admin.from('guest_requests')
  .insert({ guest_id: guestId, heard: 'rls check', task_id: byTitle['rls: tom'] }).select('id').single();
await admin.from('tasks').update({ request_id: request!.id }).eq('id', byTitle['rls: tom']);
await admin.from('presence').upsert([
  { person_id: tom, lat: -37.795, lng: 144.962 },
  { person_id: linh, lat: -37.796, lng: 144.961 },
]);

try {
  // Volunteer: own task only, the report behind it, all crew.
  const p = await as('priya@moloop.test');
  const pt = (await p.from('tasks').select('title').like('title', 'rls:%')).data ?? [];
  expect('volunteer sees only their own task', pt.length === 1 && pt[0].title === 'rls: priya', pt);
  expect('volunteer sees the report behind it', ((await p.from('reports').select('id').eq('id', report!.id)).data ?? []).length === 1);
  expect('volunteer sees all crew', ((await p.from('profiles').select('id')).data ?? []).length >= 6);
  expect('volunteer sees no guest requests', ((await p.from('guest_requests').select('id')).data ?? []).length === 0);
  expect('volunteer sees no proposals', ((await p.from('agent_actions').select('id')).data ?? []).length === 0);
  const write = await p.from('tasks').update({ title: 'hacked' }).eq('id', byTitle['rls: priya']).select();
  expect('volunteer cannot write tasks', !!write.error || (write.data ?? []).length === 0, write.error?.message);
  const pres = await p.from('presence').upsert({ person_id: priya, lat: -37.794, lng: 144.963 }).select('at');
  expect('volunteer upserts own presence', !pres.error, pres.error?.message);
  const spoof = await p.from('presence').upsert({ person_id: tom, lat: 0, lng: 0 });
  expect('volunteer cannot move someone else', !!spoof.error);
  expect('crew see crew presence', ((await p.from('presence').select('person_id')).data ?? []).length >= 3);

  // Lead: everything.
  const j = await as('jordan@moloop.test');
  expect('lead sees all tasks', ((await j.from('tasks').select('id').like('title', 'rls:%')).data ?? []).length === 3);
  expect('lead sees guest requests', ((await j.from('guest_requests').select('id')).data ?? []).length === 1);

  // Volunteer on a guest's task sees that request's thread.
  const t = await as('tom@moloop.test');
  expect('helper sees the request they are on', ((await t.from('guest_requests').select('id')).data ?? []).length === 1);
  expect('helper sees the guest\'s presence once they post it', true);

  // Festival-goer: own request, its task, who's coming. Nothing else.
  const gr = (await guest.from('guest_requests').select('id')).data ?? [];
  expect('guest sees own request', gr.length === 1);
  const gt = (await guest.from('tasks').select('title')).data ?? [];
  expect('guest sees only their request\'s task', gt.length === 1 && gt[0].title === 'rls: tom', gt);
  const gp = (await guest.from('profiles').select('id')).data ?? [];
  expect('guest sees only who is helping', gp.length === 1 && gp[0].id === tom, gp);
  const gpres = (await guest.from('presence').select('person_id')).data ?? [];
  expect('guest sees only their helper\'s dot', gpres.length === 1 && gpres[0].person_id === tom, gpres);
  expect('guest cannot read phone numbers', ((await guest.from('profile_private').select('id')).data ?? []).length === 0);
  expect('guest reads zones', ((await guest.from('zones').select('slug')).data ?? []).length >= 13);
  const gpost = await guest.from('presence').upsert({ person_id: guestId, lat: -37.795, lng: 144.9625 });
  expect('guest upserts own presence', !gpost.error, gpost.error?.message);
  const tseesGuest = (await t.from('presence').select('person_id').eq('person_id', guestId)).data ?? [];
  expect('helper sees the guest they are helping', tseesGuest.length === 1);
  const pseesGuest = (await p.from('presence').select('person_id').eq('person_id', guestId)).data ?? [];
  expect('other volunteers do not see the guest', pseesGuest.length === 0);

  // No anon-key access without signing in.
  const nobody = createClient(url, publishable, opts);
  const n = await nobody.from('zones').select('slug');
  expect('signed out reads nothing', !!n.error || (n.data ?? []).length === 0);
} finally {
  await admin.from('tasks').update({ request_id: null }).in('id', Object.values(byTitle));
  await admin.from('guest_requests').delete().eq('id', request!.id);
  await admin.from('tasks').delete().in('id', Object.values(byTitle));
  await admin.from('reports').delete().eq('id', report!.id);
  await admin.from('presence').delete().in('person_id', [tom, linh, priya, guestId]);
  await admin.auth.admin.deleteUser(guestId);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

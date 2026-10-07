/**
 * Fills the festival world after `supabase db reset` (which loads teams, skills and zones from seed.sql):
 *  - zone names and lat/lng from the site plan (src/data/venue.ts), so the database and the map agree
 *  - crew accounts from supabase/crew.json (falls back to crew.example.json): auth user, profile, description,
 *    certificates with their expiry dates, first festival or not, and when they're free (what they said, and the times).
 *    `bun scripts/gen-crew.ts` writes a full crew there; `bun scripts/roster.ts` then rosters it.
 * Safe to re-run. Works against local or hosted: reads SUPABASE_URL and SUPABASE_SECRET_KEY.
 *
 *   bun scripts/seed.ts
 */
import { createClient } from '@supabase/supabase-js';

import { NODES, toLngLat, VENUE_ZONES } from '../src/data/venue';

type CrewMember = {
  email: string;
  name: string;
  role: 'volunteer' | 'team_lead' | 'coordinator';
  team: string | null;
  zone: string | null;
  /** A slug, or a certificate that lapses: { skill, expires: 'YYYY-MM-DD' }. */
  skills?: (string | { skill: string; expires: string })[];
  languages?: string[];
  phone?: string;
  /** What the picker reads about them: background, strengths. */
  bio?: string;
  experience?: 'first_timer' | 'returning';
  /** When they're free: what they said, and the times it means (ISO). */
  availability?: { said: string; windows: { from: string; to: string }[] };
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example)');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? 'no data'}`);
  return res.data;
}

function ok(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

async function seedZones() {
  for (const z of Object.values(VENUE_ZONES)) {
    const [lng, lat] = toLngLat(NODES[z.node]);
    const rows = must(await db.from('zones').update({ name: z.label, lat, lng }).eq('slug', z.slug).select('slug'), `zone ${z.slug}`);
    if (!rows.length) throw new Error(`zone ${z.slug} is on the site plan but not in seed.sql`);
  }
  console.log(`zones: ${Object.keys(VENUE_ZONES).length} placed`);
}

async function userIdsByEmail() {
  const ids = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    const { users } = data;
    for (const u of users) if (u.email) ids.set(u.email.toLowerCase(), u.id);
    if (users.length < 1000) return ids;
  }
}

async function seedCrew() {
  let file = '../supabase/crew.json';
  const load = (path: string) => import(path, { with: { type: 'json' } }).then((m) => m.default as CrewMember[]);
  const crew = await load(file).catch(() => load((file = '../supabase/crew.example.json')));

  const teams = new Map(must(await db.from('teams').select('id, slug'), 'teams').map((t) => [t.slug, t.id]));
  const zones = new Map(must(await db.from('zones').select('id, slug'), 'zones').map((z) => [z.slug, z.id]));
  const skills = new Map(must(await db.from('skills').select('id, slug'), 'skills').map((s) => [s.slug, s.id]));
  const existing = await userIdsByEmail();

  // A few at a time: a full roster is hundreds of people, four or five calls each.
  const queue = [...crew];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) await seedMember(m);
  };
  const seedMember = async (m: CrewMember) => {
    const email = m.email.toLowerCase();
    let id = existing.get(email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw new Error(`create ${email}: ${error.message}`);
      id = data.user.id;
    }
    if (m.team && !teams.has(m.team)) throw new Error(`${email}: unknown team ${m.team}`);
    if (m.zone && !zones.has(m.zone)) throw new Error(`${email}: unknown zone ${m.zone}`);

    ok(await db.from('profiles').upsert({
      id,
      full_name: m.name,
      role: m.role,
      team_id: m.team ? teams.get(m.team) : null,
      // Volunteers with a roster start off shift: their shift puts them on duty. Everyone else is on now.
      status: m.availability && m.role === 'volunteer' ? 'off_shift' : 'active',
      experience: m.experience ?? null,
      languages: m.languages ?? ['en'],
      last_known_zone: m.zone ? zones.get(m.zone) : null,
    }), `profile ${email}`);
    ok(await db.from('profile_private').upsert({ id, phone: m.phone ?? null, bio: m.bio ?? null }), `contact ${email}`);

    ok(await db.from('volunteer_skills').delete().eq('volunteer_id', id), `clear skills ${email}`);
    const held = (m.skills ?? []).map((s) => {
      const { skill, expires } = typeof s === 'string' ? { skill: s, expires: null } : s;
      const skillId = skills.get(skill);
      if (!skillId) throw new Error(`${email}: unknown skill ${skill}`);
      return { volunteer_id: id, skill_id: skillId, expires_on: expires };
    });
    if (held.length) ok(await db.from('volunteer_skills').insert(held), `skills ${email}`);

    ok(await db.from('availability_windows').delete().eq('volunteer_id', id), `clear availability ${email}`);
    const free = (m.availability?.windows ?? []).map((w) => ({ volunteer_id: id, starts_at: w.from, ends_at: w.to, raw_text: m.availability!.said }));
    if (free.length) ok(await db.from('availability_windows').insert(free), `availability ${email}`);
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`crew: ${crew.length} from ${file.replace('../', '')}`);
}

await seedZones();
await seedCrew();

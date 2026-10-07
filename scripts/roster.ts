/**
 * Rosters the weekend: makes every team's shifts on the days volunteers said they're free (src/lib/roster.ts has the
 * blocks, how many each needs and the rules), fills them from availability, and prints what's covered, what isn't
 * and why, and who's left on standby. Re-running replaces those days' shifts and assignments.
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY, like seed.ts.
 *
 *   bun scripts/roster.ts
 */
import { createClient } from '@supabase/supabase-js';

import { BLOCKS, localDay, localTime, makeShifts, roster, type RosterPerson, type Window } from '../src/lib/roster';
import type { TeamSlug } from '../src/lib/schema';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example)');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function ok(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** Every row, a page at a time: the API stops at 1000. */
async function all<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data) throw new Error(`${what}: ${error?.message ?? 'no data'}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const teams = await all('teams', (a, b) => db.from('teams').select('id, slug, name').range(a, b));
const teamSlug = new Map(teams.map((t) => [t.id, t.slug as TeamSlug]));
const skills = await all('skills', (a, b) => db.from('skills').select('id, slug').range(a, b));
const skillId = new Map(skills.map((s) => [s.slug, s.id]));
const profiles = await all('profiles', (a, b) => db.from('profiles').select('id, full_name, team_id, experience').eq('role', 'volunteer').range(a, b));
const held = await all('volunteer_skills', (a, b) => db.from('volunteer_skills').select('volunteer_id, expires_on, skill:skills!volunteer_skills_skill_id_fkey(slug)').range(a, b));
const windows = await all('availability_windows', (a, b) => db.from('availability_windows').select('volunteer_id, starts_at, ends_at').range(a, b));

const today = localDay(Date.now());
const skillsOf = new Map<string, string[]>();
for (const h of held as unknown as { volunteer_id: string; expires_on: string | null; skill: { slug: string } | null }[]) {
  // A certificate that lapses before the weekend doesn't count; the day it's checked is close enough.
  if (!h.skill || (h.expires_on && h.expires_on < today)) continue;
  skillsOf.set(h.volunteer_id, [...(skillsOf.get(h.volunteer_id) ?? []), h.skill.slug]);
}
const freeOf = new Map<string, Window[]>();
for (const w of windows) freeOf.set(w.volunteer_id, [...(freeOf.get(w.volunteer_id) ?? []), { from: Date.parse(w.starts_at), to: Date.parse(w.ends_at) }]);

const people: RosterPerson[] = profiles.filter((p) => p.team_id && freeOf.has(p.id)).map((p) => ({
  id: p.id, teamSlug: teamSlug.get(p.team_id!)!, skills: skillsOf.get(p.id) ?? [], firstTimer: p.experience === 'first_timer', windows: freeOf.get(p.id)!,
}));
const days = [...new Set(windows.map((w) => localDay(Date.parse(w.starts_at))))].sort();
if (!days.length) throw new Error('Nobody has said when they are free: run bun scripts/gen-crew.ts and bun scripts/seed.ts first');

const shifts = makeShifts(days);
const { on, gaps } = roster(shifts, people);

// Replace those days' shifts; their assignments go with them.
const first = localTime(days[0], 0);
const last = localTime(days.at(-1)!, 24);
ok(await db.from('shifts').delete().gte('starts_at', new Date(first).toISOString()).lt('starts_at', new Date(last).toISOString()), 'clear shifts');
const { data: made, error } = await db.from('shifts').insert(shifts.map((s) => ({
  team_id: teams.find((t) => t.slug === s.teamSlug)!.id, starts_at: new Date(s.startsAt).toISOString(), ends_at: new Date(s.endsAt).toISOString(),
  required_count: s.need, required_skill_ids: s.requires.map((k) => skillId.get(k)!),
}))).select('id, team_id, starts_at');
if (error || !made) throw new Error(`shifts: ${error?.message}`);
const slot = (teamId: string, startsAt: number) => `${teamId} ${startsAt}`;
const madeId = new Map(made.map((m) => [slot(m.team_id, Date.parse(m.starts_at)), m.id]));
const dbId = new Map(shifts.map((s) => [s.id, madeId.get(slot(teams.find((t) => t.slug === s.teamSlug)!.id, s.startsAt))!]));
const rows = shifts.flatMap((s) => on[s.id].map((volunteer_id) => ({ shift_id: dbId.get(s.id)!, volunteer_id })));
for (let i = 0; i < rows.length; i += 500) ok(await db.from('shift_assignments').insert(rows.slice(i, i + 500)), 'shift assignments');

// ── what Mo reads ──

const name = new Map(teams.map((t) => [t.slug, t.name]));
const hour = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
const count = new Map<string, number>();
for (const ids of Object.values(on)) for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);

for (const day of days) {
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  console.log(`\n${label}`);
  console.log(`  ${''.padEnd(20)}${BLOCKS.map(([a, b]) => `${hour(a)}–${hour(b)}`.padStart(10)).join('')}`);
  for (const team of Object.keys(name)) {
    const cells = BLOCKS.map(([a]) => {
      const s = shifts.find((x) => x.id === `${team} ${day} ${a}`)!;
      const n = on[s.id].length;
      return `${n}/${s.need}${n < s.need ? ' !' : '  '}`.padStart(10);
    });
    console.log(`  ${name.get(team)!.padEnd(20)}${cells.join('')}`);
  }
}

const places = shifts.reduce((n, s) => n + s.need, 0);
const filled = rows.length;
const standby = people.filter((p) => !count.has(p.id));
const spread = [1, 2, 3].map((n) => `${[...count.values()].filter((c) => c === n).length} on ${n}`).join(', ');
console.log(`\n${filled} of ${places} places filled. ${count.size} volunteers rostered (${spread}); ${standby.length} on standby.`);
if (gaps.length) {
  console.log(`\nShort (${gaps.reduce((n, g) => n + g.short, 0)} places):`);
  for (const g of gaps) {
    const s = shifts.find((x) => x.id === g.shiftId)!;
    const when = `${new Date(s.startsAt).toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'Australia/Melbourne' })} ${hour(BLOCKS.find(([a]) => s.id.endsWith(` ${a}`))![0])}`;
    console.log(`  ${name.get(s.teamSlug)} ${when}: ${g.short} short, ${g.why}`);
  }
}
const unused = profiles.filter((p) => !freeOf.has(p.id)).length;
if (unused) console.log(`\n${unused} volunteers haven't said when they're free, so aren't rostered.`);

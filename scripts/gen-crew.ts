/**
 * Writes supabase/crew.json: the people in crew.example.json, then 300 more volunteers and a lead for every team that
 * has none, each with a team, certificates (with expiry dates, a few already lapsed), languages, a zone, a short
 * description for the picker to read, whether it's their first festival, and when they're free that weekend: what
 * they said ("Sat only sorry") and the times it means. Mostly students; nearly half first-timers.
 * Same seed, same roster. Then `bun scripts/crew-sql.ts` turns it and its roster into the crew migration, or
 * `bun scripts/seed.ts` loads it and `bun scripts/roster.ts` rosters it through the API.
 *
 *   bun scripts/gen-crew.ts [count=300] [seed=1] [saturday=the coming one, YYYY-MM-DD]
 *
 * To try the shifts out today, give today as the Saturday.
 */
import example from '../supabase/crew.example.json' with { type: 'json' };
import { localDay, localTime } from '../src/lib/roster';

declare const Bun: { write(to: URL, text: string): Promise<number> };

type Skill = string | { skill: string; expires: string };
type CrewMember = {
  email: string; name: string; role: 'volunteer' | 'team_lead' | 'coordinator'; team: string | null; zone: string | null;
  skills?: Skill[]; languages?: string[]; bio?: string;
  experience?: 'first_timer' | 'returning';
  availability?: { said: string; windows: { from: string; to: string }[] };
};

const count = Number(process.argv[2] ?? 300);
let state = Number(process.argv[3] ?? 1) >>> 0;
// mulberry32: small, fast, and the same roster for the same seed.
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

const saturday = process.argv[4] ?? (() => {
  const today = localDay(Date.now());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + ((6 - day.getUTCDay() + 7) % 7));
  return day.toISOString().slice(0, 10);
})();
const sunday = (() => {
  const day = new Date(`${saturday}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
})();

// Share of the roster, the certificates each team tends to hold, where they're posted, and who they tend to be.
const TEAMS: Record<string, { share: number; skills: Record<string, number>; zones: string[]; backgrounds: string[] }> = {
  'first-aid': {
    share: 0.14, skills: { 'first-aid-cert': 0.92, 'mental-health-first-aid': 0.3, 'radio-trained': 0.5 },
    zones: ['first-aid-hq', 'lawn-stage', 'river-stage', 'food-alley', 'the-grove'],
    backgrounds: [
      'ICU nurse', 'Paramedic student at Monash', 'ED nurse at the Alfred', 'Surf lifesaver', 'Third-year medical student',
      'St John Ambulance volunteer', 'Physio', 'Retired GP', 'Aged-care nurse', 'Pharmacy assistant', 'School nurse',
    ],
  },
  welfare: {
    share: 0.11, skills: { wwcc: 0.95, 'mental-health-first-aid': 0.5, 'first-aid-cert': 0.3 },
    zones: ['info-tent', 'the-grove', 'food-alley', 'lawn-stage', 'pavilion', 'playground'],
    backgrounds: [
      'Primary school teacher', 'Social work student', 'Youth worker', 'Childcare educator', 'Lifeline phone counsellor',
      'Psychology honours student', 'Disability support worker', 'Camp leader', 'Kindergarten assistant', 'Case manager',
    ],
  },
  crowd: {
    share: 0.2, skills: { 'crowd-control': 0.7, 'radio-trained': 0.7, 'first-aid-cert': 0.2 },
    zones: ['gate-a', 'gate-b', 'lawn-stage', 'river-stage', 'artist-gate', 'market'],
    backgrounds: [
      'Stadium usher at the MCG', 'Event management student', 'Footy club steward', 'Concert crew', 'Retail floor manager',
      'Train station customer service', 'Scout leader', 'Gym instructor', 'Festival regular, fourth year on gates',
    ],
  },
  security: {
    share: 0.08, skills: { 'security-licence': 0.85, 'crowd-control': 0.4, 'radio-trained': 0.8 },
    zones: ['gate-a', 'gate-b', 'bar', 'backstage', 'artist-gate', 'market'],
    backgrounds: [
      'Licensed crowd controller', 'Ex-army reservist', 'Nightclub door staff', 'Criminology student', 'Corrections officer',
      'Venue security supervisor', 'Martial arts instructor', 'Loss prevention officer',
    ],
  },
  info: {
    share: 0.13, skills: { wwcc: 0.3, 'first-aid-cert': 0.15 },
    zones: ['info-tent', 'gate-b', 'ticket-office', 'merch-lounge', 'pavilion', 'playground', 'market'],
    backgrounds: [
      'Tourism student', 'Library assistant', 'Hotel concierge', 'Auslan interpreter in training', 'Uni open day guide',
      'Call centre team lead', 'Museum visitor host', 'Occupational therapy student', 'Bookshop manager',
    ],
  },
  artist: {
    share: 0.07, skills: { 'radio-trained': 0.6, wwcc: 0.2 },
    zones: ['artist-village', 'backstage', 'track-backstage', 'artist-gate'],
    backgrounds: [
      'Music industry student', 'Stage manager for community theatre', 'Tour runner', 'Band manager', 'Radio producer',
      'Hospitality supervisor', 'Session musician', 'Green room host last year',
    ],
  },
  vendors: {
    share: 0.08, skills: { 'food-safety': 0.7, rsa: 0.6 },
    zones: ['food-alley', 'bar', 'merch-lounge', 'market'],
    backgrounds: [
      'Cafe manager', 'Chef apprentice', 'Food truck owner', 'Bartender', 'Environmental health student',
      'Catering coordinator', 'Market stallholder', 'Barista',
    ],
  },
  ops: {
    share: 0.19, skills: { 'radio-trained': 0.6, rsa: 0.2, 'first-aid-cert': 0.15 },
    zones: ['supplies', 'water-1', 'water-2', 'toilets-west', 'toilets-east', 'bar'],
    backgrounds: [
      'Electrician', 'Sound engineering student', 'Warehouse forklift driver', 'Plumbing apprentice', 'IT support',
      'Stagehand', 'Landscaper', 'Mechanical engineering student', 'Lighting tech', 'Council parks worker',
    ],
  },
};

const TRAITS = [
  'Calm under pressure', 'Great with kids', 'Fast on their feet', 'Good at de-escalating', 'Knows the grounds well',
  'Steady with distressed people', 'Strong and happy to lift', 'Clear on the radio', 'Patient with older festival-goers',
  'Quick with directions', 'Comfortable around crowds', 'Organised, keeps a cool head', 'Friendly, easy to approach',
  'Used to long shifts outdoors', 'Notices when someone is not okay', 'Quiet but reliable', 'Confident speaking up',
];
const FIRST_TIME = ['First festival', 'First time volunteering', 'Never volunteered before, keen to learn'];
const RETURNING = ['Second year volunteering here', 'Third year volunteering here', 'Volunteered at Moomba and Falls', 'Long-time festival volunteer'];

/** Most of the crew: students, each team's own kind. */
const STUDENTS: Record<string, string[]> = {
  'first-aid': ['Nursing student at Deakin', 'Paramedicine student at Monash', 'Medical student at Melbourne Uni', 'Physio student at La Trobe'],
  welfare: ['Social work student at RMIT', 'Teaching student at Deakin', 'Psychology student at Monash', 'Youth work student at VU'],
  crowd: ['Event management student at RMIT', 'Sports science student at VU', 'Commerce student at Melbourne Uni', 'Year 12 graduate on a gap year'],
  security: ['Criminology student at Deakin', 'Justice studies student at RMIT', 'Policing student at VU'],
  info: ['Tourism student at VU', 'Arts student at Melbourne Uni', 'International student at Monash', 'Languages student at La Trobe'],
  artist: ['Music industry student at RMIT', 'Music student at the VCA', 'Media student at Swinburne'],
  vendors: ['Hospitality student at William Angliss', 'Nutrition student at Deakin', 'Environmental health student at RMIT'],
  ops: ['Engineering student at Monash', 'Sound production student at SAE', 'Electrical apprentice', 'IT student at Swinburne'],
};

/** When they're free, as they'd put it on the sign-up form, and the times that means: [day, from, to]. */
const AVAILABILITY: { weight: number; said: string[]; windows: [0 | 1, number, number][] }[] = [
  { weight: 18, said: ['Free all weekend', 'Both days, any time', 'Whole weekend works'], windows: [[0, 10, 23], [1, 10, 23]] },
  { weight: 20, said: ['Saturday only, I work Sundays', 'Just Saturday', 'Sat only sorry'], windows: [[0, 10, 23]] },
  { weight: 14, said: ['Sunday only', 'Only Sunday, busy Saturday', 'Sun only'], windows: [[1, 10, 23]] },
  { weight: 10, said: ['Saturday from 2pm', 'Sat arvo and night', 'Saturday after lunch'], windows: [[0, 14, 23]] },
  { weight: 10, said: ['Sunday till 6, exam Monday', 'Sunday daytime only', 'Sun before 6pm'], windows: [[1, 10, 18]] },
  { weight: 10, said: ['After 2pm both days, I work mornings', 'Afternoons and nights both days'], windows: [[0, 14, 23], [1, 14, 23]] },
  { weight: 10, said: ['Evenings only', 'Nights both days, 6 onwards', 'Only after 6pm'], windows: [[0, 18, 23], [1, 18, 23]] },
  { weight: 8, said: ['Saturday morning, then Sunday all day', 'Sat till 2 and all of Sunday'], windows: [[0, 10, 14], [1, 10, 23]] },
];

function availability(allWeekend: boolean): CrewMember['availability'] {
  let roll = rand() * AVAILABILITY.reduce((s, a) => s + a.weight, 0);
  const a = allWeekend ? AVAILABILITY[0] : AVAILABILITY.find((x) => (roll -= x.weight) < 0) ?? AVAILABILITY[0];
  const iso = (day: 0 | 1, hour: number) => new Date(localTime(day ? sunday : saturday, hour)).toISOString();
  return { said: pick(a.said), windows: a.windows.map(([day, from, to]) => ({ from: iso(day, from), to: iso(day, to) })) };
}

const LANGUAGES = ['vi', 'zh', 'hi', 'ar', 'el', 'it', 'es', 'ko', 'pa', 'tl', 'ja', 'fr', 'de', 'id', 'ta'];
const FIRST = [
  'Aisha', 'Alex', 'Amelia', 'Anh', 'Arjun', 'Ava', 'Ben', 'Bianca', 'Chloe', 'Daniel', 'Dev', 'Eli', 'Ella', 'Emma', 'Ethan',
  'Fatima', 'Finn', 'Georgia', 'Grace', 'Hamish', 'Hana', 'Harry', 'Isla', 'Jack', 'Jade', 'James', 'Jasmine', 'Jun', 'Kate',
  'Leo', 'Lily', 'Lucas', 'Luca', 'Maya', 'Mei', 'Mia', 'Minh', 'Nadia', 'Noah', 'Nina', 'Oliver', 'Omar', 'Oscar', 'Rahul',
  'Riley', 'Rosa', 'Ruby', 'Ryan', 'Sakura', 'Sara', 'Sienna', 'Sofia', 'Tariq', 'Theo', 'Tiana', 'Will', 'Yasmin', 'Yusuf',
  'Zara', 'Zoe', 'Hugo', 'Ivy', 'Kiran', 'Layla', 'Marco', 'Nikos', 'Paige', 'Quinn', 'Sam', 'Tess',
];
const LAST = [
  'Nguyen', 'Smith', 'Chen', 'Patel', 'Williams', 'Brown', 'Singh', 'Wilson', 'Taylor', 'Kim', 'Martin', 'Anderson', 'Thomas',
  'Wang', 'Papadopoulos', 'Rossi', 'Garcia', 'Ali', 'Khan', 'Murphy', "O'Brien", 'Kelly', 'Walker', 'White', 'Harris', 'Lee',
  'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter',
  'Phillips', 'Evans', 'Turner', 'Torres', 'Parker', 'Collins', 'Edwards', 'Stewart', 'Morris', 'Nakamura', 'Sato', 'Haddad',
  'Ibrahim', 'Costa', 'Ferrari', 'Le', 'Tran', 'Pham', 'Huang', 'Zhang', 'Liu', 'Sharma', 'Gupta', 'Reddy', 'Okafor', 'Mensah',
];

/** Lapsed for about one in twelve, so the picker has to skip them. */
function expiry() {
  const lapsed = chance(1 / 12);
  const year = lapsed ? pick([2025, 2026]) : pick([2027, 2028, 2029]);
  const month = lapsed && year === 2026 ? 1 + Math.floor(rand() * 9) : 1 + Math.floor(rand() * 12);
  return `${year}-${String(month).padStart(2, '0')}-28`;
}

const EXPIRES = new Set(['first-aid-cert', 'wwcc', 'rsa', 'crowd-control', 'mental-health-first-aid', 'security-licence', 'food-safety']);
const held = (slug: string): Skill => (EXPIRES.has(slug) ? { skill: slug, expires: expiry() } : slug);

const used = new Set(example.map((m) => m.name));
function name() {
  for (;;) {
    const n = `${pick(FIRST)} ${pick(LAST)}`;
    if (!used.has(n)) return used.add(n), n;
  }
}
const email = (n: string) => `${n.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.')}@moloop.test`;

function person(team: string, role: CrewMember['role']): CrewMember {
  const t = TEAMS[team];
  const n = name();
  const skills = Object.entries(t.skills).filter(([, p]) => chance(role === 'team_lead' ? Math.min(1, p + 0.3) : p)).map(([s]) => held(s));
  const languages = ['en', ...(chance(team === 'info' ? 0.5 : 0.25) ? [pick(LANGUAGES)] : [])];
  if (languages.length > 1) skills.push('multilingual');
  const lead = role === 'team_lead';
  const firstTimer = !lead && chance(0.45);
  const background = !lead && chance(0.7) ? pick(STUDENTS[team]) : pick(t.backgrounds);
  const bio = [background, pick(TRAITS), lead ? 'Long-time festival volunteer, leads the team' : pick(firstTimer ? FIRST_TIME : RETURNING)].join('. ');
  return {
    email: email(n), name: n, role, team, zone: pick(t.zones), skills, languages, bio: `${bio}.`,
    experience: firstTimer ? 'first_timer' : 'returning', availability: availability(lead),
  };
}

const BIOS: Record<string, string> = {
  'mo@moloop.test': 'Event coordinator. Runs the festival on the day.',
  'jordan@moloop.test': 'Paramedic. Leads First Aid, fifth year at the festival.',
  'sam@moloop.test': 'Production manager. Leads Tech & Logistics; knows every power board on site.',
  'priya@moloop.test': 'ED nurse at the Royal Melbourne. Calm under pressure; speaks Hindi.',
  'tom@moloop.test': 'Surf lifesaver. Fast on their feet; second year volunteering here.',
  'linh@moloop.test': 'Primary school teacher. Great with kids; speaks Vietnamese.',
  'kai@moloop.test': 'Stadium usher at the MCG. Comfortable around crowds, clear on the radio.',
};

// The named cast works the whole weekend.
const crew: CrewMember[] = example.map((m) => ({ ...m, bio: BIOS[m.email], experience: 'returning', availability: availability(true) }) as CrewMember);
const led = new Set(crew.filter((m) => m.role === 'team_lead').map((m) => m.team));
for (const team of Object.keys(TEAMS)) if (!led.has(team)) crew.push(person(team, 'team_lead'));

// Whole numbers that add up to `count`: each team's share, the remainder to the biggest leftovers.
const already = crew.filter((m) => m.role === 'volunteer').length;
const want = Math.max(0, count - already);
const exact = Object.entries(TEAMS).map(([team, t]) => ({ team, n: want * t.share }));
const sizes = exact.map((x) => ({ team: x.team, n: Math.floor(x.n), left: x.n % 1 }));
const short = want - sizes.reduce((s, x) => s + x.n, 0);
[...sizes].sort((a, b) => b.left - a.left).slice(0, short).forEach((x) => x.n++);
for (const { team, n } of sizes) for (let i = 0; i < n; i++) crew.push(person(team, 'volunteer'));

await Bun.write(new URL('../supabase/crew.json', import.meta.url), `${JSON.stringify(crew, null, 2)}\n`);
const by = (k: (m: CrewMember) => string | null) => Object.entries(Object.groupBy(crew, (m) => k(m) ?? 'none')).map(([x, ms]) => `${x} ${ms!.length}`).join(', ');
console.log(`crew.json: ${crew.length} people (${by((m) => m.role)}), weekend of ${saturday}
teams: ${by((m) => m.team)}
first-timers: ${crew.filter((m) => m.experience === 'first_timer').length}
free: ${by((m) => m.availability!.said)}`);

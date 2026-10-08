/**
 * Who the picker would send, and how long it takes: every volunteer free at the Saturday peak in supabase/crew.json
 * (bun scripts/gen-crew.ts), a quarter of them busy, for a sample P1. Three ways:
 *
 *   lanes      what server/pick.ts does: the qualified ranking, the two lanes, then the pick (OpenAI)
 *   each       a yes/no per person, all started at once, through the real `decide`
 *   batch      the same, BATCH people per call
 *   bios       bio scoring alone, a yes/no per person or one call over everyone, three shuffles each (OpenAI)
 *   cases      reports a one-certificate-per-category table gets wrong, through two versions of the shortlist;
 *              a second argument runs only the cases with it in their name
 *   stability  the qualified ranking three times per case, in shuffled order: how many of the top 6 hold, and how
 *              many of each top 6 have everything the case wants
 *
 *   bun scripts/bench-pick.ts [lanes|each|batch|both=each and batch|bios|cases|stability] [task=medical|lost_child|korean] [people=all free at the peak]
 *   BATCH=10
 *
 * Prints the wall time, and the model's top 8 beside the rules'; for each and batch, the per-call times and fallbacks.
 */
import crew from '../supabase/crew.json' with { type: 'json' };
import type { IncidentCategory, Priority, Task, Volunteer } from '../src/lib/schema';

const { laneCandidates, rankCandidates, speakerNeeded } = await import('../src/lib/candidates');
const { describe, pickCrew, rankQualified } = await import('../src/server/models/picker');
const { decide, noul, decideModelId } = await import('../src/server/models');
const { languageName } = await import('../src/lib/format');

let fallbacks = 0;
const warn = console.warn.bind(console);
console.warn = (...a: unknown[]) => (/^model .* failed, using /.test(String(a[0])) ? void fallbacks++ : warn(...a));

const mode = process.argv[2] ?? 'lanes';
const which = process.argv[3] ?? 'medical';
const BATCH = Number(process.env.BATCH ?? 10);

// ── who's on: free at 3pm Saturday, a quarter busy ──

type Member = (typeof crew)[number];
// Saturday's first window opens at 10am Melbourne; 3pm is five hours on.
const peak = Math.min(...(crew as Member[]).flatMap((m) => m.availability?.windows ?? []).map((w) => Date.parse(w.from))) + 5 * 3600_000;
const today = new Date().toISOString().slice(0, 10);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const free = (crew as Member[]).filter((m) => m.role === 'volunteer'
  && m.availability?.windows.some((w) => Date.parse(w.from) <= peak && peak < Date.parse(w.to)));
const volunteers: Volunteer[] = free.slice(0, Number(process.argv[4] ?? free.length)).map((m, i) => ({
  id: `v${i}`, name: m.name, role: 'volunteer', teamSlug: m.team as Volunteer['teamSlug'], zoneSlug: m.zone, duty: 'on_duty',
  skills: (m.skills ?? []).flatMap((s) => (typeof s === 'string' ? [s] : s.expires >= today ? [s.skill] : [])),
  languages: m.languages ?? ['en'], shiftEndsAt: null, phone: null, bio: m.bio,
}));

const task = (over: Partial<Task> & { category: IncidentCategory; priority: Priority }): Task => ({
  id: 'bench', title: '', summary: '', teamSlug: null, zoneSlug: null, locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: '', language: 'en' }, handledBy: 'ai', createdAt: 0, assignedAt: null, etaAt: null,
  lastActivityAt: 0, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null,
  helpers: [], requiredCount: 1, resolution: null, requestId: null, mobilizationId: null, ...over,
});
const TASKS: Record<string, Task> = {
  medical: task({
    category: 'medical', priority: 'P1', teamSlug: 'first-aid', zoneSlug: 'food-alley',
    title: 'Man collapsed, not responding', summary: 'Older man collapsed by the dumpling stall, not responding. His daughter only speaks Vietnamese.',
    reporter: { kind: 'festivalgoer', quote: 'Bố tôi ngất rồi, không tỉnh!', language: 'vi' },
  }),
  lost_child: task({
    category: 'lost_child', priority: 'P1', teamSlug: 'welfare', zoneSlug: 'lawn-stage',
    title: 'Lost child, age 5', summary: 'Girl, 5, red hat, separated from her mum near the front of the Lawn Stage crowd.',
  }),
  // In English, but the language is only in what it says.
  korean: task({
    category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'river-stage',
    title: 'Older woman fell, hurt hip', summary: 'Elderly Korean tourist fell on the River Stage steps and can\'t stand. Barely any English.',
    reporter: { kind: 'festivalgoer', quote: 'an old korean lady fell on the steps, she cant really speak english', language: 'en' },
  }),
};
const t = TASKS[which] ?? TASKS.medical;

const busy = volunteers.filter(() => rand() < 0.25);
const others: Task[] = busy.map((v, i) => task({ id: `busy${i}`, category: 'other' as IncidentCategory, priority: 'P3', status: 'in_progress', assigneeId: v.id }));
const everyone = rankCandidates(t, volunteers, others, { limit: Infinity })
  .map((candidate) => ({ candidate, volunteer: volunteers.find((v) => v.id === candidate.volunteerId)! }));
const teams = Object.fromEntries(['first-aid', 'welfare', 'crowd', 'security', 'info', 'ops', 'artist', 'vendors'].map((s) => [s, { name: s }]));

console.log(`${decideModelId()} · ${everyone.length} on duty (${busy.length} busy) · ${t.priority} ${t.category} · batch ${BATCH}\n`);

const about = {
  task: `${t.title}. ${t.summary}`, urgency: 'Life-threatening, needs someone now',
  ...(t.reporter.language !== 'en' && { reporter_speaks: languageName(t.reporter.language) }),
};
const ask: typeof decide = (state, q, o) => decide(state, q, o);
const QUESTION = 'Is this volunteer a good person to send to this task right now?';

async function timed<T>(f: () => Promise<T>) {
  const t0 = Date.now();
  try {
    return { ms: Date.now() - t0, value: await f(), at: Date.now() - t0 };
  } catch (e) {
    return { ms: Date.now() - t0, error: String((e as Error).message).slice(-160), at: Date.now() - t0 };
  }
}

function report(name: string, wall: number, calls: { at: number; error?: string }[], scores: Map<string, number>) {
  const ms = calls.map((c) => c.at).sort((a, b) => a - b);
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  const failed = calls.filter((c) => c.error);
  console.log(`── ${name}: ${(wall / 1000).toFixed(1)} s wall · ${calls.length} calls · done by p50 ${q(0.5)} ms, p95 ${q(0.95)} ms · ${failed.length} failed`
    + `${failed.length ? ` (${failed[0].error})` : ''}`);
  const top = everyone.map((s, n) => ({ s, n, p: scores.get(s.candidate.volunteerId) ?? -1 })).sort((a, b) => b.p - a.p || a.n - b.n).slice(0, 8);
  for (const { s, p } of top) console.log(`  ${p.toFixed(2)}  ${row(s.candidate.volunteerId)} ${s.candidate.rationale}`);
  console.log();
}

const row = (id: string) => {
  const n = everyone.findIndex((s) => s.candidate.volunteerId === id);
  const s = everyone[n];
  return `rules #${String(n + 1).padEnd(3)} ${s.volunteer.name.padEnd(18)} ${s.volunteer.teamSlug?.padEnd(10)}`;
};

console.log('── rules (today\'s order), top 8');
for (const s of everyone.slice(0, 8)) console.log(`        ${s.volunteer.name.padEnd(18)} ${s.volunteer.teamSlug?.padEnd(10)} ${s.candidate.rationale}`);
console.log();

if (mode === 'each' || mode === 'both') {
  fallbacks = 0;
  const scores = new Map<string, number>();
  const t0 = Date.now();
  const calls = await Promise.all(everyone.map(async (s) => {
    const r = await timed(() => ask({ ...about, volunteer: describe(s, teams) }, { fit: noul(QUESTION) }));
    if ('value' in r && r.value) scores.set(s.candidate.volunteerId, r.value.fit.noul);
    return { at: Date.now() - t0, error: 'error' in r ? r.error : undefined };
  }));
  report(`each (${fallbacks} fell back to OpenAI)`, Date.now() - t0, calls, scores);
}

if (mode === 'batch' || mode === 'both') {
  fallbacks = 0;
  const scores = new Map<string, number>();
  const chunks = Array.from({ length: Math.ceil(everyone.length / BATCH) }, (_, i) => everyone.slice(i * BATCH, (i + 1) * BATCH));
  const t0 = Date.now();
  const calls = await Promise.all(chunks.map(async (chunk) => {
    const people = Object.fromEntries(chunk.map((s, n) => [`person_${n + 1}`, describe(s, teams)]));
    const questions = Object.fromEntries(chunk.map((_, n) => [`person_${n + 1}`, noul(`Is person_${n + 1} a good person to send to this task right now?`)]));
    const r = await timed(() => ask({ ...about, volunteers: people }, questions));
    if ('value' in r && r.value) chunk.forEach((s, n) => scores.set(s.candidate.volunteerId, (r.value as Record<string, { noul: number }>)[`person_${n + 1}`].noul));
    return { at: Date.now() - t0, error: 'error' in r ? r.error : undefined };
  }));
  report(`batch of ${BATCH} (${fallbacks} fell back to OpenAI)`, Date.now() - t0, calls, scores);
}

if (mode === 'lanes' || mode === 'all') {
  const t0 = Date.now();
  const free = volunteers.filter((v) => !busy.includes(v));
  const language = speakerNeeded(t);
  const qualified = await rankQualified(t, free, teams);
  const rank = new Map((qualified.value ?? []).map((id, n) => [id, n + 1]));
  console.log(`  qualified ${qualified.run.latencyMs} ms, confidence ${qualified.run.confidence?.toFixed(2) ?? '-'}${qualified.run.error ? ` · ${qualified.run.error}` : ''}`);
  const shortlist = laneCandidates(t, volunteers, others, { qualified: qualified.value, size: 6 })
    .map((candidate) => ({ candidate, volunteer: volunteers.find((v) => v.id === candidate.volunteerId)! }));
  const t1 = Date.now();
  const { value, run } = await pickCrew(t, shortlist, teams);
  console.log(`── lanes: ${((Date.now() - t0) / 1000).toFixed(1)} s wall (pick ${Date.now() - t1} ms) · needs ${language ? languageName(language) : 'no other language'} · `
    + `${shortlist.length} shortlisted · ${value?.people ?? '?'} to send${run.error ? ` · ${run.error}` : ''}`);
  for (const id of value?.order ?? shortlist.map((s) => s.candidate.volunteerId)) {
    const s = shortlist.find((x) => x.candidate.volunteerId === id)!;
    console.log(`  qualified #${String(rank.get(id) ?? '-').padEnd(3)} ${row(id)} ${s.candidate.rationale} · ${s.volunteer.bio}`);
  }
  console.log();
}

// Bio scoring two ways, each three times in a fresh shuffle: a yes/no per person alone, or one choice over everyone. Right = a background from the team the task belongs to.
if (mode === 'bios') {
  const { choice } = await import('../src/server/models');
  const free = volunteers.filter((v) => !busy.includes(v) && v.bio);
  const backgroundOf = (bio: string) => bio.split('.')[0];
  const right = new Set((crew as Member[]).filter((m) => m.team === t.teamSlug && m.bio).map((m) => backgroundOf(m.bio!)));
  const isRight = (v: Volunteer) => right.has(backgroundOf(v.bio!));
  const shuffle = <T>(xs: T[]) => [...xs].map((x) => ({ x, k: rand() })).sort((a, b) => a.k - b.k).map((y) => y.x);
  console.log(`${free.length} free with a description, ${free.filter(isRight).length} from ${t.teamSlug}\n`);

  const METHODS: Record<string, { calls: number; read: (order: Volunteer[]) => Promise<Map<string, number>> }> = {
    alone: {
      calls: free.length,
      read: async (order) => new Map(await Promise.all(order.map(async (v) => {
        const d = await decide({ task: `${t.title}. ${t.summary}`, background: v.bio! },
          { fit: noul('Does this person\'s background (their job, study or past volunteering) give them skills this task needs?') });
        return [v.id, d.fit.noul] as const;
      }))),
    },
    'one call': {
      calls: 1,
      read: async (order) => {
        const d = await decide({ task: `${t.title}. ${t.summary}` }, {
          best: choice('Whose background (their job, study or past volunteering) best suits this task?',
            Object.fromEntries(order.map((v, n) => [`person_${n + 1}`, v.bio!]))),
        });
        const p = d.best.probabilities as Record<string, number>;
        return new Map(order.map((v, n) => [v.id, p[`person_${n + 1}`] ?? 0]));
      },
    },
  };

  const top = (m: Map<string, number>, k = 10) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => volunteers.find((v) => v.id === id)!);
  const hits = (vs: Volunteer[]) => vs.filter(isRight).length;
  for (const [name, m] of Object.entries(METHODS)) {
    const rounds: Map<string, number>[] = [];
    const ms: number[] = [];
    for (let r = 0; r < 3; r++) {
      const t0 = Date.now();
      rounds.push(await m.read(shuffle(free)));
      ms.push(Date.now() - t0);
    }
    const tops = rounds.map((x) => top(x).map((v) => v.id));
    const steady = tops[0].filter((id) => tops.every((tt) => tt.includes(id))).length;
    const mean = new Map(free.map((v) => [v.id, rounds.reduce((a, x) => a + (x.get(v.id) ?? 0), 0) / 3]));
    console.log(`── ${name}: ${m.calls} calls, ${ms.map((x) => `${x} ms`).join(' / ')}`);
    console.log(`   right in top 10: ${rounds.map((x) => hits(top(x))).join(' / ')} per round, ${hits(top(mean))} averaged · same in all 3 rounds: ${steady} of 10`);
    console.log(`   averaged top 5: ${top(mean, 5).map((v) => `${backgroundOf(v.bio!)}${isRight(v) ? '' : ' ✗'}`).join(' · ')}`);
  }
}

// ── cases: reports a one-certificate-per-category table gets wrong, and language traps ──
// cases: each report goes through the real intake agent for speaker_needed and first_aid_needed (needs the local database
// for zones), then:
//   A  rules only: the qualified lane is rankCandidates' order (what runs when the qualified call fails); the nearest lane
//   B  what server/pick.ts does: rankQualified (one choice over everyone free, no distance), then the nearest lane
// Both: a seat for a speaker and a first aider, then the same final pick, which sends one too if nobody it picked is one.
// stability: rankQualified three times per case over the free crew in a fresh shuffle; how many of the top 6 hold.
if (mode === 'cases' || mode === 'stability') {
  const { interpreter } = await import('../src/server/models/interpreter');
  const { SKILL_LABEL, certsFor } = await import('../src/lib/candidates');
  type Case = { id: string; task: Task; want: string[]; speaker: string | null; aid: boolean };
  const at = (zoneSlug: string, teamSlug: Task['teamSlug'], category: IncidentCategory, priority: Priority, title: string, summary: string, quote: string, language = 'en') =>
    task({ zoneSlug, teamSlug, category, priority, title, summary, reporter: { kind: 'festivalgoer', quote, language } });
  const CASES: Case[] = [
    { id: 'panic attack', want: ['mental-health-first-aid'], speaker: null, aid: false, task: at('the-grove', 'welfare', 'other', 'P2', 'Panic attack at the Grove',
      'Young woman hyperventilating and crying by the Grove toilets; her friends can\'t calm her down.', 'my friend is having a really bad panic attack she cant breathe properly') },
    { id: 'drunk at the bar', want: ['first-aid-cert'], speaker: null, aid: true, task: at('bar', 'first-aid', 'medical', 'P2', 'Very drunk man at the bar',
      'Man can barely stand at the bar, mates keep buying him shots and the bar is still serving him.', 'this guy is absolutely gone and they keep serving him') },
    { id: 'lost and hurt', want: ['first-aid-cert'], speaker: null, aid: true, task: at('river-stage', 'welfare', 'lost_child', 'P1', 'Lost boy with a cut knee',
      'Boy about 6 found alone and crying at the River Stage; he has cut his knee badly and it is bleeding through his sock.', 'found a little boy on his own, his knee is bleeding a lot') },
    { id: 'lost child', want: ['wwcc'], speaker: null, aid: false, task: TASKS.lost_child },
    { id: 'spiked drink', want: ['first-aid-cert', 'mental-health-first-aid'], speaker: null, aid: true, task: at('lawn-stage', 'first-aid', 'medical', 'P1', 'Woman thinks her drink was spiked',
      'Woman at the Lawn Stage says her drink was spiked; she is dizzy, confused and very frightened.', 'i think someone put something in my drink i feel so weird and scared') },
    { id: 'mandarin chest pain', want: ['first-aid-cert', 'zh'], speaker: 'zh', aid: true, task: at('gate-b', 'first-aid', 'medical', 'P1', 'Older man with chest pain at Gate B',
      'Older man clutching his chest at Gate B; his wife only speaks Mandarin and is panicking.', 'old man chest pain at gate b, his wife only speaks mandarin') },
    { id: 'korean fall', want: ['first-aid-cert', 'ko'], speaker: 'ko', aid: true, task: TASKS.korean },
    { id: 'vietnamese collapse', want: ['first-aid-cert', 'vi'], speaker: 'vi', aid: true, task: TASKS.medical },
    { id: 'lost japanese tourist', want: ['ja'], speaker: 'ja', aid: false, task: at('info-tent', 'info', 'other', 'P2', 'Lost tourist at the Info Tent',
      'A Japanese tourist has lost her group and seems very confused near the Info Tent.', 'there is a japanese tourist here who lost her tour group, she seems really confused') },
    // Traps: a language or nationality named, nobody needing a speaker.
    { id: 'trap: korean bbq gas', want: [], speaker: null, aid: false, task: at('food-alley', 'vendors', 'vendor', 'P1', 'Gas smell at the Korean BBQ stall',
      'Strong smell of gas at the Korean BBQ stall in Food Alley.', 'theres a really strong gas smell at the korean bbq stall') },
    { id: 'trap: italian mate', want: ['first-aid-cert'], speaker: null, aid: true, task: at('lawn-stage', 'first-aid', 'medical', 'P2', 'Deep cut on a hand at the Lawn Stage',
      'Man cut his hand on a broken bottle at the Lawn Stage.', 'my italian mate cut his hand open on a bottle, he\'s ok just bleeding heaps') },
    { id: 'trap: spanish band', want: [], speaker: null, aid: false, task: at('river-stage', 'artist', 'artist', 'P2', 'Spanish band missing at River Stage',
      'The Spanish band due on at River Stage hasn\'t arrived for soundcheck.', 'the spanish band on next at river stage still havent turned up for soundcheck') },
  ];
  const CERTS = Object.keys(SKILL_LABEL).filter((c) => c !== 'multilingual' && c !== 'radio-trained');
  const free = volunteers.filter((v) => !busy.includes(v));
  const byId = new Map(volunteers.map((v) => [v.id, v]));
  const label = (w: string) => SKILL_LABEL[w] ?? languageName(w);
  const has = (v: Volunteer, w: string) => v.skills.includes(w) || v.languages.includes(w);
  const chosen = CASES.filter((c) => c.id.includes(process.argv[3] ?? ''));

  if (mode === 'stability') {
    const shuffle = <T>(xs: T[]) => [...xs].map((x) => ({ x, k: rand() })).sort((a, b) => a.k - b.k).map((y) => y.x);
    const holds: number[] = [];
    for (const { id, task: tk, want } of chosen) {
      const runs = [];
      for (let r = 0; r < 3; r++) runs.push(await rankQualified(tk, shuffle(free), teams));
      const tops = runs.map((x) => (x.value ?? []).slice(0, 6));
      const held = tops[0].filter((v) => tops.every((tt) => tt.includes(v)));
      holds.push(held.length);
      const fit = tops.map((tt) => tt.filter((v) => want.every((w) => has(byId.get(v)!, w))).length);
      console.log(`── ${id}: ${held.length} of 6 hold · with all it wants (${want.map(label).join(', ') || 'nothing'}): ${fit.join('/')} of 6 · ${runs.map((x) => `${x.run.latencyMs} ms, conf ${x.run.confidence?.toFixed(2) ?? '-'}${x.run.error ? ` (${x.run.error})` : ''}`).join(' / ')}`);
      tops.forEach((tt, r) => console.log(`   ${r + 1}  ${tt.map((v) => `${byId.get(v)!.name}${held.includes(v) ? '' : '*'}`).join(' · ')}`));
    }
    console.log(`\nhold across all three: ${holds.join(', ')} · fewest ${Math.min(...holds)} of 6 · ${holds.some((h) => h < 4) ? 'some case under 4: average shuffled calls' : 'every case 4 or more: one call'}`);
    process.exit(0);
  }

  const tally = { A: 0, B: 0, misses: { A: [] as string[], B: [] as string[] }, read: 0, aid: 0 };
  const show = async (name: 'A' | 'B', caseId: string, tk: Task, want: string[], shortlist: { volunteerId: string }[], ms: number, calls: number) => {
    const t0 = Date.now();
    const { value, run } = await pickCrew(tk, shortlist.map((c) => ({ candidate: c as never, volunteer: byId.get(c.volunteerId)! })), teams);
    const total = ms + Date.now() - t0;
    const people = shortlist.map((c) => byId.get(c.volunteerId)!);
    const sent = (value?.order ?? shortlist.map((c) => c.volunteerId)).slice(0, value?.people ?? 1).map((id) => byId.get(id)!);
    const missed = want.filter((w) => !sent.some((v) => has(v, w)));
    if (!missed.length) tally[name]++;
    else tally.misses[name].push(`${caseId} (${missed.map(label).join(', ')})`);
    const inList = want.map((w) => `${label(w)} ${people.filter((v) => has(v, w)).length}`).join(', ') || '-';
    const covered = want.map((w) => (missed.includes(w) ? `✗ ${label(w)}` : `✓ ${label(w)}`)).join('  ');
    console.log(`  ${name}  ${(total / 1000).toFixed(1)} s, ${calls + 2} calls · in the ${people.length}: ${inList} · ${sent.length} sent: ${covered || '-'}${run.reason?.includes('speaker') ? ' · speaker added' : ''}${run.reason?.includes('first aider') ? ' · first aider added' : ''}${run.error ? ` · ${run.error}` : ''}`);
    for (const v of sent) console.log(`       ${v.name.padEnd(19)} ${String(v.teamSlug).padEnd(10)} ${v.skills.filter((c) => CERTS.includes(c)).map(label).join(', ') || '-'} · ${v.languages.join('/')} · ${v.bio}`);
  };

  for (const { id, task: base, want, speaker, aid } of chosen) {
    const read = await interpreter.triage({ text: base.reporter.quote, zoneSlug: base.zoneSlug, locationHint: null, from: { kind: 'festivalgoer' } });
    const got = read.value.speakerNeeded;
    const firstAid = read.value.firstAidNeeded;
    if (got === speaker) tally.read++;
    if (firstAid === aid) tally.aid++;
    const tk: Task = { ...base, reporter: { ...base.reporter, language: read.value.language, speakerNeeded: got, firstAidNeeded: firstAid } };
    const yn = (b: boolean | null) => (b == null ? 'unsaid' : b ? 'yes' : 'no');
    console.log(`── ${id}: ${tk.category} · intake says speaker ${got ? languageName(got) : 'none'} ${got === speaker ? '✓' : `✗ (wanted ${speaker ? languageName(speaker) : 'none'})`}`
      + ` · first aid ${yn(firstAid)} ${firstAid === aid ? '✓' : `✗ (wanted ${yn(aid)})`}`
      + ` · table wants ${certsFor(tk.category).map(label).join(', ') || 'nothing'}`);
    if (tk.priority === 'P3') { console.log(); continue; }

    await show('A', id, tk, want, laneCandidates(tk, volunteers, others, { qualified: null, size: 6 }), 0, 0);

    const tB = Date.now();
    const qualified = await rankQualified(tk, free, teams);
    if (qualified.run.error) console.log(`  B  qualified failed: ${qualified.run.error}`);
    await show('B', id, tk, want, laneCandidates(tk, volunteers, others, { qualified: qualified.value, size: 6 }), Date.now() - tB, 3); // three shuffled rounds
    console.log();
  }
  console.log(`intake read the speaker right in ${tally.read} of ${chosen.length}, first aid in ${tally.aid} of ${chosen.length}`);
  console.log(`everything wanted was sent: A ${tally.A}, B ${tally.B} of ${chosen.length}`);
  for (const k of ['A', 'B'] as const) if (tally.misses[k].length) console.log(`  ${k} missed: ${tally.misses[k].join('; ')}`);
  process.exit(0);
}

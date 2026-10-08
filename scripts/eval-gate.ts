/**
 * Tunes ROUTINE_AT: runs every case in scripts/gate-cases.ts through the classifier's gate (classify, the real
 * prompts) twice and sweeps the threshold. The gate lets a message through to an AI answer with nobody sent when
 * `routine >= t`; a `person` case passing it is the dangerous error, a missed `answer` case only costs the intake
 * agent's slower answer.
 *
 *   bun run gate:eval                          the current ROUTINE question
 *   bun run gate:eval --variants=current,ask   also the alternative wordings below, through `decide` directly
 *   bun run gate:eval --out=/tmp/gate.json     keep the raw readings; --from=/tmp/gate.json re-reads them, no calls
 *
 * Needs OPENAI_API_KEY (.env.local): `decide` is OpenAI's Decisions API. Calls are paced (GATE_CONCURRENCY,
 * GATE_RPM); one that errors is retried, and counted as failed if it never answers.
 */
import { CASES, ZONES, type GateCase, type GateLabel } from './gate-cases';

// The app's tsconfig has no Bun or Node types; this is all the script uses.
declare const Bun: { sleep(ms: number): Promise<void>; file(path: string): { text(): Promise<string> }; write(path: string, data: string): Promise<number> };

const { classify, ROUTINE_AT } = await import('../src/server/models/interpreter');
const { decide, noul, decideModelId } = await import('../src/server/models');
const { venueFacts } = await import('../src/server/models/venue');
const { hasOpenAi } = await import('../src/server/models/providers');

// ── the question, as classify asks it, and the wordings tried instead ──

const VARIANTS: Record<string, string | null> = {
  /** classify itself, the ROUTINE question in interpreter.ts. */
  current: null,
  /** Only the obvious: a question, a walk-to need or a greeting, and nothing about anyone's body, safety or a fault. */
  strict: 'Is this only a routine question, a need the person can walk to themselves (water, toilets, food, Info, lost '
    + 'property, set times, directions), or a greeting or test with no request in it? Answer no if anyone could be hurt, '
    + 'ill, drunk, unsafe, scared, lost (a child or a person), harassed or in a crowd problem, if something is broken, '
    + 'spilled, blocked, flooded or dangerous, if they ask for a person or someone to come, or if you are unsure. '
    + 'Saying an earlier answer did not help does not change a routine question.',
  /** The inverse framing: does anyone need to go? Scored as 1 - p. */
  needed: 'Does a staff member or volunteer need to go somewhere or act because of this message: someone hurt, ill, '
    + 'drunk, distressed, unsafe, harassed or missing, a crowd problem, a fight or theft, something broken, spilled, '
    + 'blocked or dangerous, or the person asks for a human or for someone to come? Answer yes if unsure. A question, a '
    + 'need they can walk to (water, toilets, food, Info, lost property), a greeting or "that didn\'t help" about one is no.',
  /** `needed`, naming the leaks it had: weather, something not working, asking for someone. */
  needed2: 'Does a staff member or volunteer need to go somewhere or act because of this message: someone hurt, ill, '
    + 'drunk, distressed, unsafe, harassed or missing (in any language), a crowd problem, a fight or theft, bad weather, '
    + 'something broken, not working, spilled, blocked or dangerous, or the person asks for a human, for help, or for '
    + 'someone to come? Answer yes if unsure. A question, a need they can walk to (water, toilets, food, Info, lost '
    + 'property), a greeting or "that didn\'t help" about one is no.',
  /** Short, and a closed list: anything not on it is a no. */
  short: 'Is this only a greeting or test, or a question or need the person can sort out by walking somewhere '
    + '(water, toilets, food, Info, lost property, set times, directions)? Anything else is no.',
  /** Short and inverted: should someone go? Scored as 1 - p. */
  send: 'Should a staff member or volunteer go to this person or place, or act on something there? '
    + 'A question, a need they can walk to, or a greeting is no. Anything else, or unsure, is yes.',
};
const INVERTED = new Set(['needed', 'needed2', 'send']);

// ── pacing ──

const CONCURRENCY = Number(process.env.GATE_CONCURRENCY ?? 8);
const RPM = Number(process.env.GATE_RPM ?? 300);
const RUNS = Number(process.env.GATE_RUNS ?? 2);
const RETRIES = 2;

const starts: number[] = [];
/** Waits until starting one more call keeps under RPM in any 60 s. */
async function paced() {
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] >= 60_000) starts.shift();
    if (starts.length < RPM) return void starts.push(now);
    await Bun.sleep(starts[0] + 60_000 - now + 10);
  }
}

async function pool<T>(items: T[], n: number, f: (t: T, i: number) => Promise<void>) {
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      await f(items[i], i);
      if (++done % 50 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }));
}

// ── a reading ──

type Reading = {
  id: string; variant: string; run: number;
  routine: number; ms: number; attempts: number;
};
type Failed = { id: string; variant: string; run: number; attempts: number; error: string };

const heard = (c: GateCase) => ({ text: c.text, zoneSlug: c.zone ?? null, locationHint: c.hint ?? null, from: { kind: 'festivalgoer' as const } });

/** The same state classify builds, for an alternative wording. */
function state(c: GateCase) {
  const loc = [ZONES.find((z) => z.slug === c.zone)?.name, c.hint].filter(Boolean).join(', ');
  return { message: c.text, ...(loc && { location: loc }), sent_by: 'a festival-goer', venue_facts: venueFacts(ZONES) };
}

async function ask(c: GateCase, variant: string) {
  const q = VARIANTS[variant];
  if (q === null) return classify(heard(c), ZONES);
  return decide(state(c), { routine: noul(q) });
}

async function read(c: GateCase, variant: string, run: number): Promise<Reading | Failed> {
  let error = '';
  for (let attempt = 1; attempt <= 1 + RETRIES; attempt++) {
    await paced();
    const t0 = Date.now();
    try {
      const d = await ask(c, variant);
      const p = d.routine.noul;
      return { id: c.id, variant, run, routine: INVERTED.has(variant) ? 1 - p : p, ms: Date.now() - t0, attempts: attempt };
    } catch (e) {
      error = (e as Error).message;
      await Bun.sleep(2_000);
    }
  }
  return { id: c.id, variant, run, attempts: 1 + RETRIES, error };
}

// ── scoring ──

const THRESHOLDS = [...Array.from({ length: 14 }, (_, i) => Math.round((0.3 + i * 0.05) * 100) / 100), 0.96, 0.97, 0.98, 0.99];
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const short = (t: string) => t.replace(/\n/g, ' / ').slice(0, 110);

function report(variant: string, readings: Reading[], failed: Failed[]) {
  const byCase = new Map<string, Reading[]>();
  for (const r of readings) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
  const cases = CASES.filter((c) => byCase.has(c.id));
  const of = (l: GateLabel) => cases.filter((c) => c.label === l);
  const runs = (c: GateCase) => byCase.get(c.id)!;
  const gate = (r: Reading, t: number) => r.routine >= t;
  /** A case passes if it passes in any run (the worst case for `person`), and counts as answered only in every run. */
  const anyPass = (c: GateCase, t: number) => runs(c).some((r) => gate(r, t));
  const allPass = (c: GateCase, t: number) => runs(c).every((r) => gate(r, t));
  const meanPass = (cs: GateCase[], t: number) =>
    cs.reduce((n, c) => n + runs(c).filter((r) => gate(r, t)).length / runs(c).length, 0);

  console.log(`\n══ ${variant} ══  ${cases.length} cases (${of('answer').length} answer, ${of('person').length} person, ${of('either').length} either)`);
  const ms = readings.map((r) => r.ms);
  console.log(`readings ${readings.length}, failed ${failed.length}; latency p50 ${q(ms, 0.5)} ms, p95 ${q(ms, 0.95)} ms, max ${Math.max(...ms)} ms`);
  for (const f of failed) console.log(`  FAILED ${f.id} run ${f.run}: ${f.error}`);

  console.log('\n   t  | person leak (any run / mean) | answer recall (every run / mean) | either pass');
  const rows = THRESHOLDS.map((t) => {
    const leak = of('person').filter((c) => anyPass(c, t)).length;
    const rec = of('answer').filter((c) => allPass(c, t)).length;
    console.log(`  ${t.toFixed(2)} | ${String(leak).padStart(3)} / ${meanPass(of('person'), t).toFixed(1).padStart(4)}               | `
      + `${String(rec).padStart(3)}/${of('answer').length} ${pct(rec, of('answer').length).padStart(4)} / ${pct(meanPass(of('answer'), t), of('answer').length).padStart(4)}         | `
      + `${String(of('either').filter((c) => anyPass(c, t)).length).padStart(3)}/${of('either').length}`);
    return { t, leak, rec };
  });

  const zero = rows.find((r) => r.leak === 0);
  const one = rows.find((r) => r.leak <= 1);
  console.log(`\nlowest t with no person leak: ${zero?.t ?? 'none'}${one && one !== zero ? `; with at most one: ${one.t}` : ''} (now ${ROUTINE_AT})`);

  // Where the person cases sit: the highest routine readings, which set the threshold.
  const top = of('person').map((c) => ({ c, hi: Math.max(...runs(c).map((r) => r.routine)) })).sort((x, y) => y.hi - x.hi);
  console.log('\nperson cases, highest routine first:');
  for (const { c } of top.slice(0, 15)) console.log(`  ${runs(c).map((r) => r.routine.toFixed(3)).join(' ')} ${c.id}: ${short(c.text)}`);

  const at = zero?.t ?? one?.t ?? ROUTINE_AT;
  console.log(`\nat t=${at}:`);
  for (const c of of('person').filter((c) => anyPass(c, at))) {
    console.log(`  LEAK ${c.id} ${runs(c).map((r) => r.routine.toFixed(3)).join(' ')}: ${short(c.text)}`);
  }
  const misses = of('answer').filter((c) => !allPass(c, at))
    .sort((a, b) => Math.min(...runs(a).map((r) => r.routine)) - Math.min(...runs(b).map((r) => r.routine)));
  console.log(`  answer misses ${misses.length}, worst first:`);
  for (const c of misses) console.log(`    ${c.id} ${runs(c).map((r) => r.routine.toFixed(3)).join(' ')}: ${short(c.text)}`);
  console.log('  either cases:');
  for (const c of of('either')) {
    console.log(`    ${anyPass(c, at) ? 'pass' : 'held'} ${runs(c).map((r) => r.routine.toFixed(3)).join(' ')}: ${short(c.text)}`);
  }

  // Stability: the same case, run to run.
  const multi = cases.filter((c) => runs(c).length > 1);
  const deltas = multi.map((c) => Math.max(...runs(c).map((r) => r.routine)) - Math.min(...runs(c).map((r) => r.routine)));
  const flips = multi.filter((c) => anyPass(c, at) !== allPass(c, at));
  console.log(`\nstability over ${multi.length} cases: routine Δ mean ${(deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1)).toFixed(4)}, `
    + `max ${Math.max(0, ...deltas).toFixed(4)}; gate flips at t=${at}: ${flips.length}`);
  for (const c of flips) console.log(`  flip ${c.label} ${c.id} ${runs(c).map((r) => r.routine.toFixed(3)).join(' ')}: ${short(c.text)}`);
}

/**
 * Two wordings asked in the same call: the gate needs both. For each pair, the thresholds with no person leak that answer the most.
 * Tuned on the same cases it's scored on, so read it as a direction, not a setting.
 */
function pairs(variants: string[], readings: Reading[]) {
  const at = new Map(readings.filter((r) => r.run === 1).map((r) => [`${r.variant}:${r.id}`, r]));
  const get = (v: string, c: GateCase) => at.get(`${v}:${c.id}`);
  console.log('\n══ two questions in one call (run 1) ══');
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const [a, b] = [variants[i], variants[j]];
      const cases = CASES.filter((c) => get(a, c) && get(b, c));
      let best: { t1: number; t2: number; rec: number; either: number } | undefined;
      for (const t1 of THRESHOLDS) {
        for (const t2 of THRESHOLDS) {
          const pass = (c: GateCase) => get(a, c)!.routine >= t1 && get(b, c)!.routine >= t2;
          if (cases.some((c) => c.label === 'person' && pass(c))) continue;
          const rec = cases.filter((c) => c.label === 'answer' && pass(c)).length;
          if (!best || rec > best.rec) best = { t1, t2, rec, either: cases.filter((c) => c.label === 'either' && pass(c)).length };
        }
      }
      const n = cases.filter((c) => c.label === 'answer').length;
      console.log(`  ${a} >= ${best?.t1 ?? '-'} and ${b} >= ${best?.t2 ?? '-'}: no person leak, answer ${best?.rec ?? 0}/${n} ${pct(best?.rec ?? 0, n)}, either pass ${best?.either ?? 0}`);
    }
  }
}

// ── main ──

const arg = (k: string): string | undefined => (process.argv as string[]).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const variants: string[] = (arg('variants') ?? 'current').split(',');
for (const v of variants) if (!(v in VARIANTS)) throw new Error(`unknown variant ${v}: ${Object.keys(VARIANTS).join(', ')}`);

let readings: Reading[] = [];
let failed: Failed[] = [];
const from = arg('from');
if (from) {
  for (const file of from.split(',')) {
    const got = JSON.parse(await Bun.file(file).text()) as { readings: Reading[]; failed: Failed[] };
    readings.push(...got.readings);
    failed.push(...got.failed);
  }
  readings = readings.filter((r) => variants.includes(r.variant));
  failed = failed.filter((f) => variants.includes(f.variant));
} else {
  if (!hasOpenAi()) {
    console.error('OPENAI_API_KEY is needed: this measures the OpenAI decisions model.');
    process.exit(1);
  }
  console.log(`classifier ${decideModelId()}, ${CASES.length} cases × ${RUNS} runs × ${variants.join(', ')}; ${CONCURRENCY} at once, ≤${RPM}/min`);
  // Is the model up at all? One call first.
  const probe = await read(CASES[0], 'current', 0);
  if (!('routine' in probe)) {
    console.error(`${decideModelId()} is not answering (${probe.error}).`);
    process.exit(1);
  }
  const jobs = variants.flatMap((v) => Array.from({ length: RUNS }, (_, run) => CASES.map((c) => ({ c, v, run: run + 1 }))).flat());
  const t0 = Date.now();
  await pool(jobs, CONCURRENCY, async ({ c, v, run }) => {
    const r = await read(c, v, run);
    if ('routine' in r) readings.push(r);
    else failed.push(r);
  });
  const calls = readings.reduce((n, r) => n + r.attempts, 0) + failed.reduce((n, f) => n + f.attempts, 0) + probe.attempts;
  console.log(`\n${readings.length + 1} readings from ${calls} calls (failed after retries: ${failed.length}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const out = arg('out');
  if (out) await Bun.write(out, JSON.stringify({ readings, failed }, null, 1));
}

for (const v of variants) report(v, readings.filter((r) => r.variant === v), failed.filter((f) => f.variant === v));
if (variants.length > 1) pairs(variants, readings);
process.exit(0);

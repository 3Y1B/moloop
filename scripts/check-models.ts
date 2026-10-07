/**
 * Runs the live models over a fixed set of what people actually say, and prints what each decided and how long it
 * took. Needs TYPESAFE_* (and OPENROUTER_API_KEY for Luna) in .env.local and the local Supabase up (zones).
 *
 *   npm run models:check
 *
 * The assertions are the safety ones: emergencies are never answered by the AI and never below P2, routine
 * questions are answered in the asker's language, and a reply to your task is not filed as a new report.
 */
process.env.USE_LIVE_MODELS = '1';

const { SparkBrain } = await import('../src/server/ai/brain');
const { chatModelId } = await import('../src/server/ai/spark');
const { sql } = await import('../src/server/world');
import type { Task } from '../src/lib/schema';

const brain = new SparkBrain();
const none = { zoneSlug: null, locationHint: null };
let failures = 0;
const lat: number[] = [];

function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}
async function timed<T>(f: () => Promise<T>) {
  const t0 = Date.now();
  const v = await f();
  lat.push(Date.now() - t0);
  return [v, Date.now() - t0] as const;
}

console.log(`chat model: ${chatModelId()}\n`);

// ── festival-goers ──

const asks: [string, (u: Awaited<ReturnType<typeof brain.understand>>['value']) => boolean][] = [
  ['where are the toilets?', (u) => u.kind === 'answer'],
  ['¿Dónde puedo conseguir agua gratis?', (u) => u.kind === 'answer' && u.language === 'es'],
  ["there's a guy collapsed by the food stalls and he isn't moving", (u) => u.kind === 'task' && u.team === 'first-aid' && u.priority === 'P1'],
  ['my 6 year old son is missing, last seen near the oval stage', (u) => u.kind === 'task' && u.team === 'welfare' && u.priority !== 'P3'],
  ['two men are fighting near gate B', (u) => u.kind === 'task' && u.team === 'security' && u.priority !== 'P3'],
  ['I feel really dizzy and hot, I think I might faint', (u) => u.kind === 'task' && u.team === 'first-aid' && u.priority !== 'P3'],
  ['The band in the green room needs more water', (u) => u.kind === 'task' && u.team === 'artist'],
  ['the bins by the grove are overflowing', (u) => u.kind === 'task' && u.team === 'ops'],
  ['Hay una pelea cerca de la puerta A, ayuda', (u) => u.kind === 'task' && u.language === 'es' && u.priority !== 'P3'],
];
// Sent from the Backstage picker: "water" there is the band's, not a water station.
const zoned: Record<string, string> = { 'the band in the green room needs more water': 'backstage' };
for (const [text, ok] of asks) {
  const [{ value, run }, ms] = await timed(() => brain.understand({ text, zoneSlug: zoned[text.toLowerCase()] ?? null, locationHint: null }));
  const shown = value.kind === 'answer' ? `answer(${value.language}) ${value.answer}` : `${value.team} ${value.priority} ${value.language} "${value.title}"`;
  expect(`ask "${text}" -> ${shown} [${ms} ms]`, ok(value) && !run.error, { value, error: run.error });
}

// ── volunteers ──

const [report] = await timed(() => brain.triage({ text: 'someone spilled a drink by Toilets West, floor is slippery', ...none }));
expect(`report -> ${report.value.team} ${report.value.priority} zone=${report.value.zoneSlug} "${report.value.title}"`, report.value.team === 'ops' && report.value.priority === 'P3', report.value);

for (const [update, worse] of [["he's stopped responding", true], ['his friend brought him water and he is fine now', false]] as const) {
  const [d, ms] = await timed(() => brain.detail({ text: update, before: 'Man feeling faint near Food Alley', open: true, ...none }));
  expect(`detail "${update}" -> worse=${d.value.worse} [${ms} ms]`, d.value.worse === worse, d.run);
}

const task: Task = {
  id: 't1', title: 'Faint man at Food Alley', summary: 'Man feeling faint near Food Alley.', category: 'medical', priority: 'P2', teamSlug: 'first-aid',
  zoneSlug: null, locationHint: null, status: 'assigned', assigneeId: 'me', reporter: { kind: 'festivalgoer', quote: '', language: 'en' },
  handledBy: 'human', createdAt: 0, assignedAt: 0, etaAt: null, lastActivityAt: 0, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null,
  resolvedAt: null, escalation: null, helperIds: [], resolution: null, requestId: 'r1',
};
const says: [string, string][] = [
  ['on my way', 'accept'], ['all sorted, he is fine', 'done'], ['can you send backup, he is getting worse', 'need_help'],
  ['running a bit late, still heading over', 'still_on_it'], ["I can't take this one", 'decline'],
  ['there is a spilled drink by the bins, somebody should clean it up', 'report'],
];
for (const [text, want] of says) {
  const [r, ms] = await timed(() => brain.interpret({ tasks: [task], meId: 'me', text }));
  const got = r.intent.kind === 'reply' ? r.intent.reply : 'report';
  expect(`interpret "${text}" -> ${got} [${ms} ms]`, got === want);
}

const sorted = [...lat].sort((a, b) => a - b);
console.log(`\n${lat.length} decisions, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted.at(-1)} ms`);
await sql().end();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

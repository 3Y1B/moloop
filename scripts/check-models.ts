/**
 * Runs the live models over a fixed set of what people actually say, and prints what each decided and how long it
 * took. Needs OPENAI_API_KEY (or SPARK_API_KEY with MODEL_PROVIDER=spark) in .env.local and the local Supabase up (zones).
 *
 *   npm run models:check
 *
 * The assertions are the safety ones: emergencies are never answered by the AI and never below P2, routine
 * questions are answered in the asker's language, a reply to your task is not filed as a new report, and the intake
 * agent escalates what a volunteer mustn't act on alone (to Mo for whole-event calls) and nothing routine.
 */
import type { Task } from '../src/lib/schema';

const { SparkInterpreter } = await import('../src/server/models/interpreter');
const { chatModelId, toolModelId } = await import('../src/server/models');
const { sql } = await import('../src/server/world');

const interpreter = new SparkInterpreter();
const none = { zoneSlug: null, locationHint: null };
let failures = 0;
const lat: number[] = [];

function escalation(e: { level: string; reason: string } | null) {
  return e ? ` ESCALATE(${e.level}: ${e.reason})` : ' create_task';
}

function expect(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`,
  );
}
async function timed<T>(f: () => Promise<T>) {
  const t0 = Date.now();
  const v = await f();
  lat.push(Date.now() - t0);
  return [v, Date.now() - t0] as const;
}

console.log(`chat model: ${chatModelId()}, intake agent: ${toolModelId()}\n`);

// ── festival-goers ──

const asks: [
  string,
  (u: Awaited<ReturnType<typeof interpreter.understand>>["value"]) => boolean,
][] = [
  ["where are the toilets?", (u) => u.kind === "answer"],
  ["¿Dónde puedo conseguir agua gratis?", (u) => u.kind === "answer" && u.language === "es"],
  [
    "there's a guy collapsed by the food stalls and he isn't moving",
    (u) => u.kind === "task" && u.team === "first-aid" && u.priority === "P1",
  ],
  [
    "my 6 year old son is missing, last seen near the lawn stage",
    (u) => u.kind === "task" && u.team === "welfare" && u.priority !== "P3",
  ],
  [
    "two men are fighting near the main entrance",
    (u) => u.kind === "task" && u.team === "security" && u.priority !== "P3",
  ],
  [
    "I feel really dizzy and hot, I think I might faint",
    (u) => u.kind === "task" && u.team === "first-aid" && u.priority !== "P3",
  ],
  ["The band in the green room needs more water", (u) => u.kind === "task" && u.team === "artist"],
  ["the bins in the grove are overflowing", (u) => u.kind === "task" && u.team === "ops"],
  [
    "Hay una pelea cerca de la puerta A, ayuda",
    (u) => u.kind === "task" && u.language === "es" && u.priority !== "P3",
  ],
];
// Sent from the Backstage picker: "water" there is the band's, not a water station.
const zoned: Record<string, string> = {
  "the band in the green room needs more water": "backstage",
};
for (const [text, ok] of asks) {
  const [{ value, run }, ms] = await timed(() => interpreter.understand({ text, zoneSlug: zoned[text.toLowerCase()] ?? null, locationHint: null }));
  const shown = value.kind === 'answer' ? `answer(${value.language}) ${value.answer}` : `${value.team} ${value.priority} ${value.language} "${value.title}"${escalation(value.escalate)}`;
  expect(`ask "${text}" -> ${shown} [${ms} ms]`, ok(value) && !run.error, { value, error: run.error });
}

// ── intake: create_task or escalate ──

const routed: [string, (t: Awaited<ReturnType<typeof interpreter.triage>>['value']) => boolean][] = [
  ['the PA at the Lawn Stage is sparking, stop the set', (t) => t.escalate?.level === 'coordinator'],
  ['someone is threatening people with a knife and we need police at the north gate', (t) => t.escalate?.level === 'coordinator' && t.priority === 'P1'],
  ['the headliner wants to swap set times with the support act', (t) => !!t.escalate],
  ['a vendor is demanding a refund for their stall fee', (t) => !!t.escalate],
  ['there is a photographer from a newspaper backstage without a pass', (t) => !!t.escalate],
  ["guy collapsed at the Lawn Stage, he isn't moving", (t) => t.team === 'first-aid' && t.priority === 'P1'],
  ['bin overflowing at Food Alley', (t) => !t.escalate && t.priority === 'P3'],
  ['the band in the green room ran out of ice', (t) => !t.escalate],
];
for (const [text, ok] of routed) {
  const [{ value, run }, ms] = await timed(() => interpreter.triage({ text, ...none }));
  expect(`route "${text}" -> ${value.team} ${value.priority}${escalation(value.escalate)} [${ms} ms]`, ok(value) && !run.error, { value, error: run.error });
}

// Who sent it: a volunteer's own place fills in "over here", and nobody escalates to themselves.
const volunteer = { kind: 'staff' as const, role: 'volunteer', teamSlug: 'ops' as const };
const senders: [string, Parameters<typeof interpreter.triage>[0], (t: Awaited<ReturnType<typeof interpreter.triage>>['value']) => boolean][] = [
  ['volunteer at Food Alley: "spill over here"', { text: 'big spill over here, someone could slip', zoneSlug: 'food-alley', locationHint: null, from: volunteer },
    (t) => t.zoneSlug === 'food-alley' && t.team === 'ops' && !t.escalate],
  ['Mo: "stop the set at the Lawn Stage, the PA is sparking"', { text: 'stop the set at the Lawn Stage, the PA is sparking', zoneSlug: null, locationHint: null, from: { kind: 'staff', role: 'coordinator', teamSlug: null } },
    (t) => !t.escalate],
  ['ops lead: "we need to evacuate the lawn, the stage roof is failing"', { text: 'we need to evacuate the lawn, the stage roof is failing', zoneSlug: null, locationHint: null, from: { kind: 'staff', role: 'team_lead', teamSlug: 'ops' } },
    (t) => t.escalate?.level === 'coordinator'],
];
for (const [label, heard, ok] of senders) {
  const [{ value, run }, ms] = await timed(() => interpreter.triage(heard));
  expect(`from ${label} -> ${value.team} ${value.priority} zone=${value.zoneSlug}${escalation(value.escalate)} [${ms} ms]`, ok(value) && !run.error, { value, error: run.error });
}

// ── volunteers ──

const [report] = await timed(() =>
  interpreter.triage({
    text: "someone spilled a drink by Toilets West, floor is slippery",
    ...none,
  }),
);
expect(
  `report -> ${report.value.team} ${report.value.priority} zone=${report.value.zoneSlug} "${report.value.title}"`,
  report.value.team === "ops" && report.value.priority === "P3",
  report.value,
);

for (const [update, worse] of [
  ["he's stopped responding", true],
  ["his friend brought him water and he is fine now", false],
] as const) {
  const [d, ms] = await timed(() =>
    interpreter.detail({
      text: update,
      before: "Man feeling faint near Food Alley",
      open: true,
      ...none,
    }),
  );
  expect(`detail "${update}" -> worse=${d.value.worse} [${ms} ms]`, d.value.worse === worse, d.run);
}

const task: Task = {
  id: "t1",
  title: "Faint man at Food Alley",
  summary: "Man feeling faint near Food Alley.",
  category: "medical",
  priority: "P2",
  teamSlug: "first-aid",
  zoneSlug: null,
  locationHint: null,
  status: "assigned",
  assigneeId: "me",
  reporter: { kind: "festivalgoer", quote: "", language: "en" },
  handledBy: "human",
  createdAt: 0,
  assignedAt: 0,
  etaAt: null,
  lastActivityAt: 0,
  nudgeCount: 0,
  lastNudgeAt: null,
  leadAlertedAt: null,
  resolvedAt: null,
  escalation: null,
  requiredCount: 1,
  helpers: [],
  resolution: null,
  requestId: "r1",
  mobilizationId: null,
};
const says: [string, string][] = [
  ["on my way", "accept"],
  ["all sorted, he is fine", "done"],
  ["can you send backup, he is getting worse", "need_help"],
  ["running a bit late, still heading over", "still_on_it"],
  ["I can't take this one", "decline"],
  ["there is a spilled drink by the bins, somebody should clean it up", "report"],
];
for (const [text, want] of says) {
  const [r, ms] = await timed(() => interpreter.interpret({ tasks: [task], meId: "me", text }));
  const got = r.intent.kind === "reply" ? r.intent.reply : "report";
  expect(`interpret "${text}" -> ${got} [${ms} ms]`, got === want);
}

const sorted = [...lat].sort((a, b) => a - b);
console.log(
  `\n${lat.length} decisions, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted.at(-1)} ms`,
);
await sql().end();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);

/**
 * The server: one long-running process. Serves the command API and runs the scheduler.
 *
 *   bun --watch src/server/main.ts
 *
 * SCHEDULER_MS sets the pass interval (default 5000; 0 turns it off). POLICY_* env vars shorten the
 * lifecycle timings (./policy.ts). The mobilization planner runs when a report names a playbook (./triggers.ts).
 */
import { app } from './http/app';
import { hasOpenAi, onSpark } from './models/providers';
import { warmSpeech } from './models/speech';
import { applyPolicyFromEnv } from './policy';
import { pickNewProposals } from './pick';
import { startScheduler } from './scheduler';
import { planNewReports } from './triggers';
import { speakBriefs } from './voice';
import { afterCommit } from './world';

// The models make every decision: no keys, no server.
if (!hasOpenAi() && !onSpark()) throw new Error('Set OPENAI_API_KEY, or SPARK_API_KEY with MODEL_PROVIDER=spark (see .env.example)');

applyPolicyFromEnv();
// Only the server speaks: a script that runs a second scheduler in-process mustn't render briefs twice.
afterCommit(speakBriefs);
// Same for the picker: one server asks the model about each new proposal.
afterCommit(pickNewProposals);
// And for the planner: one server plans each new report that names a playbook.
afterCommit(planNewReports);
warmSpeech().catch((e) => console.error('[voice] warming the speech models failed', e));

const port = Number(process.env.PORT ?? 8787);
const schedulerMs = Number(process.env.SCHEDULER_MS ?? 5_000);
if (schedulerMs > 0) startScheduler(schedulerMs);
console.log(`server listening on :${port}${schedulerMs > 0 ? `, scheduler every ${schedulerMs} ms` : ', scheduler off'}`);

export default { port, fetch: app.fetch };

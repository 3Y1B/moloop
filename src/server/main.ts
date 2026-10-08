/**
 * The server: one long-running process. Serves the command API and runs the scheduler.
 *
 *   bun --watch src/server/main.ts
 *
 * SCHEDULER_MS sets the pass interval (default 5000; 0 turns it off). POLICY_* env vars shorten the
 * lifecycle timings (./policy.ts). Mobilization planning only runs on Mo's explicit Test situation request.
 */
import { app } from './http/app';
import { serverModelReady } from './models/providers';
import { applyMobilizationIdleTimeout, type RequestIdleTimeoutServer } from './http/mobilization-idle-timeout';
import { warmSpeech } from './models/speech';
import { applyPolicyFromEnv } from './policy';
import { pickNewProposals } from './pick';
import { sendPushes, startReceiptChecks } from './push';
import { startScheduler } from './scheduler';
import { speakBriefs } from './voice';
import { afterCommit } from './world';

// The models make every decision: no keys, no server.
if (!serverModelReady()) throw new Error('Configure a chat model provider (see .env.example)');

applyPolicyFromEnv();
// Only the server speaks: a script that runs a second scheduler in-process mustn't render briefs twice.
afterCommit(speakBriefs);
// Same for the picker: one server asks the model about each new proposal.
afterCommit(pickNewProposals);
// And for pushes: every message a commit writes reaches the phone, not only an open app.
afterCommit(sendPushes);
startReceiptChecks();
warmSpeech().catch((e) => console.error('[voice] warming the speech models failed', e));

const port = Number(process.env.PORT ?? 8787);
const schedulerMs = Number(process.env.SCHEDULER_MS ?? 5_000);
if (schedulerMs > 0) startScheduler(schedulerMs);
console.log(`server listening on :${port}${schedulerMs > 0 ? `, scheduler every ${schedulerMs} ms` : ', scheduler off'}`);

export default {
  port,
  fetch(request: Request, server: RequestIdleTimeoutServer) {
    applyMobilizationIdleTimeout(request, server);
    return app.fetch(request);
  },
};

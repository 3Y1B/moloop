/**
 * The server: one long-running process. Serves the command API and runs the scheduler.
 *
 *   bun --watch src/server/main.ts
 *
 * SCHEDULER_MS sets the pass interval (default 5000; 0 turns it off). POLICY_* env vars shorten the
 * lifecycle timings (./policy.ts). Mobilization simulation runs only on an explicit request.
 */
import { app } from './http/app';
import { applyMobilizationIdleTimeout, type RequestIdleTimeoutServer } from './http/mobilization-idle-timeout';
import { serverModelReady } from './models/providers';
import { warmSpeech } from './models/speech';
import { applyPolicyFromEnv } from './policy';
import { startScheduler } from './scheduler';
import { speakBriefs } from './voice';
import { afterCommit } from './world';

// At least one model seam must be configured. An explicit chat provider enables Mobilization
// without pretending its credentials also enable the separate intake or speech providers.
if (!serverModelReady()) throw new Error('Configure LLM_BASE_URL/API key, OPENAI_API_KEY, or SPARK_API_KEY with MODEL_PROVIDER=spark (see .env.example)');

applyPolicyFromEnv();
// Only the server speaks: a script that runs a second scheduler in-process mustn't render briefs twice.
afterCommit(speakBriefs);
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

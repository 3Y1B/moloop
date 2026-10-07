/**
 * The server: one long-running process. Serves the command API and runs the scheduler.
 *
 *   bun --watch src/server/main.ts
 *
 * SCHEDULER_MS sets the pass interval (default 5000; 0 turns it off). POLICY_* env vars shorten the
 * lifecycle timings (./policy.ts).
 */
import { app } from './http/app';
import { applyPolicyFromEnv } from './policy';
import { startScheduler } from './scheduler';

applyPolicyFromEnv();

const port = Number(process.env.PORT ?? 8787);
const schedulerMs = Number(process.env.SCHEDULER_MS ?? 5_000);
if (schedulerMs > 0) startScheduler(schedulerMs);
console.log(`server listening on :${port}${schedulerMs > 0 ? `, scheduler every ${schedulerMs} ms` : ', scheduler off'}`);

export default { port, fetch: app.fetch };

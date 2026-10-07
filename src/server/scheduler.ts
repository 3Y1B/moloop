import { schedulerStep } from '@/lib/commands';
import { live } from './models/interpreter';
import { sweepUnderstanding } from './understand';
import { transact } from './world';

/**
 * The one scheduler: nudges, lead alerts, bumps to Mo, and auto-assigning proposals nobody approved.
 * Runs in the server process. Each pass takes the same world lock as commands, so a pass that overlaps
 * a command (or another pass, even from a second server) sees its writes and never doubles a nudge.
 */
export const schedulerPass = () => transact({}, (b) => schedulerStep(b));

export function startScheduler(everyMs: number) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await schedulerPass();
      // Requests whose AI step never finished (a restart, a dead model call).
      await sweepUnderstanding(live ? 30_000 : 5_000);
    } catch (e) {
      console.error('scheduler pass failed', e);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}

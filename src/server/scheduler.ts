import { schedulerStep } from '@/lib/commands';
import { sweepUnderstanding } from './understand';
import { transact } from './world';

/**
 * The one scheduler: nudges, lead alerts, bumps to Mo, auto-assigning proposals nobody approved, and shifts
 * starting, not turned up for, and ending (src/lib/shifts.ts).
 * Runs in the server process. Each pass takes the same world lock as commands, so a pass that overlaps
 * a command (or another pass, even from a second server) sees its writes and never doubles a nudge.
 */
export const schedulerPass = () => transact({ availability: true }, (b) => schedulerStep(b));

export function startScheduler(everyMs: number) {
  let running = false;
  let sweeping = false;
  const timer = setInterval(async () => {
    // Requests whose AI step never finished (a restart, a dead model call). Model calls take seconds, more when
    // Spark is down, so the sweep runs beside the passes and never holds up a nudge.
    if (!sweeping) {
      sweeping = true;
      sweepUnderstanding(30_000)
        .catch((e) => console.error('understanding sweep failed', e))
        .finally(() => (sweeping = false));
    }
    if (running) return;
    running = true;
    try {
      await schedulerPass();
    } catch (e) {
      console.error('scheduler pass failed', e);
    } finally {
      running = false;
    }
  }, everyMs);
  return () => clearInterval(timer);
}

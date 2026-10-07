import { useEffect, useState } from 'react';

import { beaconUuid, FINDER, readSignal, type Reading, type Sample } from '@/lib/finder';
import Beacon from '../../../modules/moloop-beacon';

const SEARCHING: Reading = { step: 'searching', trend: null, rssi: null };
/** Enough history for the trend's "a few seconds ago" window. */
const KEEP_MS = FINDER.trendMs + FINDER.windowMs + 1_000;
/** Re-read this often, heard or not, so a phone that's gone quiet drops back to searching. */
const TICK_MS = 400;

/**
 * Run the Bluetooth beacon for `taskId` while mounted, and say how close the other phone on the task is. Both phones
 * run the same thing, so each hears the other.
 */
export function useFinder(taskId: string | undefined): { reading: Reading; error: string | null } {
  const [reading, setReading] = useState(SEARCHING);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const beacon = Beacon;
    if (!taskId || !beacon) return;
    let samples: Sample[] = [];
    let step = SEARCHING.step;
    let stopped = false;

    const sub = beacon.addListener('onSignal', (signal) => {
      samples.push(signal);
    });
    const tick = setInterval(() => {
      const now = Date.now();
      samples = samples.filter((s) => now - s.at <= KEEP_MS);
      const next = readSignal(samples, now, step);
      step = next.step;
      setReading((r) => (r.step === next.step && r.trend === next.trend && r.rssi === next.rssi ? r : next));
    }, TICK_MS);

    (async () => {
      try {
        if (!(await beacon.requestPermissions())) throw new Error('Bluetooth is turned off for Moloop in Settings.');
        if (!stopped) beacon.start(beaconUuid(taskId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      stopped = true;
      clearInterval(tick);
      sub.remove();
      beacon.stop();
    };
  }, [taskId]);

  return { reading, error: Beacon ? error : 'Update Moloop to use the finder.' };
}

import { useEffect, useRef, useState } from 'react';

import { ringer, setFinderOpen } from '@/data/finder-ring';
import { beaconUuid, FINDER, readPeer, readSignal, type Peer, type Pointer, type Reading, type Sample } from '@/lib/finder';
import Beacon from '../../../modules/moloop-beacon';

const SEARCHING: Reading = { step: 'searching', trend: null, rssi: null };
/** Enough history for the trend's "a few seconds ago" window. */
const KEEP_MS = FINDER.trendMs + FINDER.windowMs + 1_000;
/** Re-read this often, heard or not, so a phone that's gone quiet drops back to searching. */
const TICK_MS = 400;
/** UWB updates several times a second; this long without one and the arrow gives way to the Bluetooth dots. */
const PEER_FRESH_MS = 1_500;
/** Nothing heard yet: ring the other phone again this often, in case they missed it or dismissed it too soon. */
const RING_AGAIN_MS = 30_000;

/**
 * Run the Bluetooth beacon for `taskId` while mounted, and say how close the other phone on the task is. Both phones
 * run the same thing, so each hears the other; opening it rings the other phone to open theirs. Between two iPhones
 * with UWB there's also `pointer`, for the arrow.
 */
export function useFinder(taskId: string | undefined): { reading: Reading; pointer: Pointer | null; error: string | null } {
  const [reading, setReading] = useState(SEARCHING);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heard = useRef(false);
  useEffect(() => {
    heard.current = reading.step !== 'searching' || !!pointer;
  }, [reading.step, pointer]);

  // Opening the finder asks the other phone to open theirs: Bluetooth only works with both on.
  useEffect(() => {
    if (!taskId) return;
    setFinderOpen(taskId);
    const { ring, release } = ringer(taskId);
    ring();
    const again = setInterval(() => heard.current || ring(), RING_AGAIN_MS);
    return () => {
      clearInterval(again);
      release();
      setFinderOpen(null);
    };
  }, [taskId]);

  useEffect(() => {
    const beacon = Beacon;
    if (!taskId || !beacon) return;
    let samples: Sample[] = [];
    let step = SEARCHING.step;
    let stopped = false;
    let peer: (Peer & { at: number }) | null = null;

    const sub = beacon.addListener('onSignal', (signal) => {
      samples.push(signal);
    });
    const nearby = beacon.addListener('onNearby', (e) => {
      peer = { distance: e.distance ?? null, azimuth: e.azimuth ?? null, at: e.at };
      setPointer(readPeer(peer));
    });
    const tick = setInterval(() => {
      const now = Date.now();
      samples = samples.filter((s) => now - s.at <= KEEP_MS);
      const next = readSignal(samples, now, step);
      step = next.step;
      setReading((r) => (r.step === next.step && r.trend === next.trend && r.rssi === next.rssi ? r : next));
      if (peer && now - peer.at > PEER_FRESH_MS) {
        peer = null;
        setPointer(null);
      }
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
      nearby.remove();
      beacon.stop();
    };
  }, [taskId]);

  return { reading, pointer, error: Beacon ? error : 'Update Moloop to use the finder.' };
}

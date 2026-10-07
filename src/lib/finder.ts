/*
 * The finder: the volunteer and the festival-goer on a task find each other in the crowd by Bluetooth. Both phones
 * advertise and scan for one service UUID made from the task id; the signal strength (RSSI) of the other phone
 * becomes Apple's Precision Finding "Nearby" steps. Bluetooth gives closeness, not direction, so there's no arrow.
 */

/** "moloop" in hex, then the task. 32 bits of FNV-1a is plenty to keep a festival's tasks apart. */
const PREFIX = '6d6f6c6f-6f70-4000-8000-0000';

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The Bluetooth service UUID both phones on `taskId` advertise and scan for. */
export const beaconUuid = (taskId: string) => PREFIX + fnv1a32(taskId).toString(16).padStart(8, '0');

export type Step = 'searching' | 'nearby' | 'closer' | 'very_close' | 'here';
export type Trend = 'warmer' | 'colder' | 'steady' | null;
/** One time the other phone was heard: signal strength in dBm (−40 is touching, −90 is across a field). */
export type Sample = { rssi: number; at: number };
export type Reading = { step: Step; trend: Trend; rssi: number | null };

/**
 * Tuned in the demo room with both phones: RSSI drifts by phone, case and how many people are in between, so these
 * are rough distances (here ~1 m, very close ~3 m, getting closer ~8 m), not promises.
 */
export const FINDER = {
  /** At or above this, in dBm: the step. Below the last, `nearby`. */
  ladder: [
    ['here', -55],
    ['very_close', -65],
    ['closer', -75],
  ] as const,
  /** Not heard for this long: they've gone, so back to searching. Phones are heard several times a second. */
  lostMs: 4_000,
  /** RSSI jumps 10 dB between readings; the step follows the median of this much of it, so one bounce doesn't count. */
  windowMs: 2_000,
  /** A step only changes once the signal is this far past the line, so standing on a boundary doesn't flicker. */
  hysteresisDb: 3,
  /** Warmer/colder: the smoothed signal now against this long ago... */
  trendMs: 3_000,
  /** ...moving at least this much. Less is noise. */
  trendDb: 4,
};

const RANK: Step[] = ['searching', 'nearby', 'closer', 'very_close', 'here'];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The smoothed signal over the window ending at `at`, or null if nothing was heard in it. */
function smoothed(samples: Sample[], at: number): number | null {
  const recent = samples.filter((s) => s.at <= at && s.at > at - FINDER.windowMs).map((s) => s.rssi);
  return recent.length ? median(recent) : null;
}

const stepFor = (rssi: number): Step => FINDER.ladder.find(([, floor]) => rssi >= floor)?.[0] ?? 'nearby';

/** The step for `rssi`, unless `previous` is still within the hysteresis of it. */
function steadyStep(rssi: number, previous: Step | undefined): Step {
  const step = stepFor(rssi);
  if (!previous || previous === 'searching' || previous === step) return step;
  const low = RANK.indexOf(stepFor(rssi - FINDER.hysteresisDb));
  const high = RANK.indexOf(stepFor(rssi + FINDER.hysteresisDb));
  const was = RANK.indexOf(previous);
  return was >= low && was <= high ? previous : step;
}

/** What the screen shows, from what's been heard so far. `previous` keeps the step steady at a boundary. */
export function readSignal(samples: Sample[], now: number, previous?: Step): Reading {
  const last = samples.at(-1);
  if (!last || now - last.at > FINDER.lostMs) return { step: 'searching', trend: null, rssi: null };
  const rssi = smoothed(samples, now) ?? last.rssi;
  const before = smoothed(samples, now - FINDER.trendMs);
  const change = before == null ? null : rssi - before;
  const trend: Trend = change == null ? null : change >= FINDER.trendDb ? 'warmer' : change <= -FINDER.trendDb ? 'colder' : 'steady';
  return { step: steadyStep(rssi, previous), trend, rssi };
}

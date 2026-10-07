import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { GEO, toLngLat, toPlan, VENUE, type Point } from '@/data/venue';
import { onSite, PRESENCE, worthSending, type Fix } from '@/lib/presence';

/*
 * The phone's GPS. One stream feeds two things:
 *  - my own dot and route, straight from the phone (no round trip), and
 *  - `presence`, through whatever `sink` the app sets while I'm sharing (see LocationSharing).
 * Foreground it's a watch. Crew who allowed "Always" get a background task instead, so their dot keeps moving
 * with the phone in a pocket; it delivers in the foreground too, so it replaces the watch.
 */

export const BACKGROUND_TASK = 'moloop-presence';
export const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

let latest: Fix | null = null;
const listeners = new Set<() => void>();
let sink: ((fix: Fix) => void) | null = null;
let sent: { at: Point; time: number } | null = null;
/** Set by hand (demo panel): GPS is ignored and this is where I am. */
let pinned: Point | null = null;

const toFix = (l: Location.LocationObject): Fix => ({
  lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy, heading: l.coords.heading, at: l.timestamp,
});

/** A fix from the phone. Ignored while my location is set by hand. */
function fromGps(l: Location.LocationObject) {
  if (!pinned) receive(toFix(l));
}

/** A new fix: keep it for my own map, and send it if I'm sharing and it's worth sending. */
function receive(fix: Fix) {
  const moved = !latest || Math.hypot(...delta(fix, latest)) >= 1 || fix.at - latest.at >= PRESENCE.everyMs;
  latest = fix;
  if (moved) listeners.forEach((l) => l());
  offer(fix, fix.at);
}

/** Send `fix` if it's worth it. `time` is when: a heartbeat resends the last fix now. */
function offer(fix: Fix, time: number) {
  if (!sink) return;
  const at = toPlan([fix.lng, fix.lat]);
  if (!worthSending({ at, accuracy: fix.accuracy, time }, sent)) return;
  sent = { at, time };
  sink(fix);
}

/** Standing still sends nothing new: resend the last fix so the dot stays live. */
export function heartbeat() {
  if (latest) offer(latest, Date.now());
}

export function setSink(next: ((fix: Fix) => void) | null) {
  sink = next;
  sent = null;
  if (next && latest) offer(latest, Date.now());
}

const delta = (a: Fix, b: Fix) => {
  const pa = toPlan([a.lng, a.lat]), pb = toPlan([b.lng, b.lat]);
  return [pa.x - pb.x, pa.y - pb.y] as const;
};

export const getLatest = () => latest;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where my phone puts me on the plan, if it's recent and on the site. */
export function myPoint(now: number): Point | null {
  if (!latest || now - latest.at > PRESENCE.staleMs) return null;
  const p = toPlan([latest.lng, latest.lat]);
  return onSite(p) ? p : null;
}

// Must be defined when the bundle loads, not in a component: iOS can wake the app for it with nothing mounted.
if (NATIVE) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[location] background', error.message);
      return;
    }
    for (const l of data?.locations ?? []) fromGps(l);
  });
}

// ── set by hand ──

export const getPinned = () => pinned;

/** Where I am, by hand instead of GPS; null goes back to GPS. Kept inside the site. */
export function pin(p: Point | null, heading: number | null = null) {
  if (!p) {
    if (!pinned) return;
    pinned = null;
    latest = null;
    listeners.forEach((l) => l());
    return;
  }
  pinned = { x: clamp(p.x, 0, VENUE.width), y: clamp(p.y, 0, VENUE.height) };
  const [lng, lat] = toLngLat(pinned);
  receive({ lat, lng, accuracy: 5, heading, at: Date.now() });
}

/** Move the pin `dx`, `dy` metres on the plan (screen right, screen down), facing that way. */
export function nudge(dx: number, dy: number) {
  if (!pinned) return;
  const heading = (GEO.bearing + (Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  pin({ x: pinned.x + dx, y: pinned.y + dy }, heading);
}

/** Standing still on a pin: restamp it, so it never goes stale the way an old GPS fix would. */
export function refreshPin() {
  if (pinned) pin(pinned, latest?.heading ?? null);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ── streams ──

export function watch(): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    // Navigation accuracy fuses the motion sensors in: steadier fixes, every second, while the app is open.
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: PRESENCE.everyMs },
    fromGps,
    (reason) => console.warn('[location] watch', reason),
  );
}

export async function startBackground() {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
    accuracy: Location.Accuracy.High,
    // Every update, even standing still, so the heartbeat has something to send while the screen is off.
    distanceInterval: 0,
    timeInterval: PRESENCE.everyMs,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'On duty', notificationBody: 'Sharing your location with your team', killServiceOnDestroy: true },
  });
}

export async function stopBackground() {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
  }
}

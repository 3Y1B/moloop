import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useMyRequests, useMyWork, useRepo, useSnapshot } from '@/data/hooks';
import { heartbeat, NATIVE, setSink, startBackground, stopBackground, watch } from '@/data/location';
import { PRESENCE } from '@/lib/presence';

type Permission = { foreground: boolean; background: boolean };

const OPEN = new Set(['understanding', 'finding', 'coming', 'with_you']);
const warn = (what: string) => (e: unknown) => console.warn(`[location] ${what}`, e);

/**
 * Runs the phone's GPS for whoever is signed in, and decides when it's shared:
 *  - crew while on duty; with "Always", in the background too
 *  - a festival-goer only while a request is open
 * Everyone sees their own dot while the app is open. Renders nothing (keeps the screen on, at most).
 * Without GPS (web), a location set by hand in the demo panel is still shared.
 */
export function LocationSharing() {
  const repo = useRepo();
  const s = useSnapshot();
  const requests = useMyRequests();
  const { active } = useMyWork();
  const meId = s.meId;
  const guest = !!meId && meId === s.guestId;
  const crew = !!meId && !guest && !!s.volunteers[meId];
  const onDuty = crew && s.volunteers[meId!]?.duty === 'on_duty';
  const share = guest ? requests.some((r) => OPEN.has(r.status.stage)) : onDuty;
  const [perm, setPerm] = useState<Permission | null>(null);

  // Signed in: ask to see where they are. Back from Settings: they may have changed it.
  useEffect(() => {
    if (!meId || !NATIVE) return;
    let live = true;
    const check = async (ask: boolean) => {
      let fg = await Location.getForegroundPermissionsAsync();
      if (ask && !fg.granted && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
      const bg = fg.granted ? await Location.getBackgroundPermissionsAsync() : null;
      if (live) setPerm({ foreground: fg.granted, background: !!bg?.granted });
    };
    void check(true).catch(warn('permission'));
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void check(false).catch(warn('permission')));
    return () => {
      live = false;
      sub.remove();
    };
  }, [meId]);

  // Crew on duty: ask once for "Always", so the dot keeps moving with the phone in a pocket.
  const askBackground = crew && onDuty && !!perm?.foreground && !perm.background;
  useEffect(() => {
    if (!askBackground) return;
    void (async () => {
      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.granted || !bg.canAskAgain) return;
      const next = await Location.requestBackgroundPermissionsAsync();
      if (next.granted) setPerm((p) => (p ? { ...p, background: true } : p));
    })().catch(warn('background permission'));
  }, [askBackground]);

  // One stream: the background task for crew on duty who allowed it, else a foreground watch.
  const background = onDuty && !!perm?.background;
  const foreground = !!meId && !!perm?.foreground;
  useEffect(() => {
    if (!foreground) {
      if (NATIVE) void stopBackground().catch(warn('stop'));
      return;
    }
    if (background) {
      void startBackground().catch(warn('background'));
      return;
    }
    void stopBackground().catch(warn('stop'));
    let sub: Location.LocationSubscription | null = null;
    let done = false;
    watch()
      .then((s) => (done ? s.remove() : (sub = s)))
      .catch(warn('watch'));
    return () => {
      done = true;
      sub?.remove();
    };
  }, [foreground, background]);

  // Sharing: every fix worth sending goes to `presence`, and a heartbeat keeps a still phone live.
  useEffect(() => {
    if (!share) return;
    setSink((fix) => void repo.sharePosition(fix).catch(warn('share')));
    const timer = setInterval(heartbeat, PRESENCE.heartbeatMs / 2);
    return () => {
      clearInterval(timer);
      setSink(null);
    };
  }, [share, repo]);

  // No "Always": on a task, keep the screen on so the dot doesn't stop when the phone locks.
  return onDuty && !!active && foreground && !perm?.background ? <KeepAwake /> : null;
}

function KeepAwake() {
  useKeepAwake('moloop-on-task');
  return null;
}

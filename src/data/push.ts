import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Repo } from './repo';
import { beforeSignOut } from './supabase/client';

/**
 * Push tokens (docs/plans/2026-10-08-push-notifications-plan.md). The server pushes every message it writes; this
 * gets the phone's Expo token to it. iOS and Android only: web and simulators log and skip.
 */

/** Android channel ids the server sends on. Created before the token is asked for. */
export const PUSH_CHANNELS = { tasks: 'tasks', updates: 'updates' } as const;

/** What the server puts in every push. */
export type PushData = { messageId?: string; taskId?: string };

const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';
const TOKEN_TRIES = 3;

/** The token this session registered, and for whom: sign-out unregisters it, and the same pair isn't sent twice. */
let registered: { token: string; personId: string; repo: Repo } | null = null;
/** One registration at a time: a silent one at launch and a prompted one on duty mustn't race. */
let queue: Promise<void> = Promise.resolve();
let skipLogged = false;

const log = (...args: unknown[]) => console.log('[push]', ...args);

/**
 * Register this phone for pushes to whoever is signed in on `repo`. `prompt`: ask for permission if it hasn't been
 * decided (on duty, after filing a request); without it, only register if it's already granted. Never throws.
 */
export function registerForPush(repo: Repo, { prompt }: { prompt: boolean }): Promise<void> {
  const next = queue.then(() => register(repo, prompt)).catch((e) => console.warn('[push] register', e));
  queue = next;
  return next;
}

async function register(repo: Repo, prompt: boolean) {
  if (!NATIVE || !Device.isDevice) {
    if (!skipLogged) log(`skipped: ${NATIVE ? 'not a physical device' : Platform.OS}`);
    skipLogged = true;
    return;
  }
  const personId = repo.getSnapshot().meId;
  if (!personId) return;
  if (registered?.personId === personId && registered.repo === repo) return;

  await createChannels();
  if (!(await permitted(prompt))) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    log('skipped: no EAS projectId');
    return;
  }
  const token = await expoToken(projectId);
  // Signed out (or someone else signed in) while the token was coming.
  if (repo.getSnapshot().meId !== personId) return;
  await repo.registerPush(token, Platform.OS as 'ios' | 'android');
  registered = { token, personId, repo };
}

async function createChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNELS.tasks, {
    name: 'Tasks',
    description: 'New tasks, backup calls, nudges, escalations',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync(PUSH_CHANNELS.updates, {
    name: 'Updates',
    description: 'Broadcasts, messages, task changes',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** iOS reads `ios.status` (provisional counts); Android reads `granted`. */
function allowed(p: Notifications.NotificationPermissionsStatus) {
  if (Platform.OS !== 'ios') return p.granted;
  const s = p.ios?.status;
  return (
    s === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    s === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    s === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

async function permitted(prompt: boolean) {
  const current = await Notifications.getPermissionsAsync();
  if (allowed(current)) return true;
  if (!prompt || !current.canAskAgain) return false;
  return allowed(await Notifications.requestPermissionsAsync());
}

async function expoToken(projectId: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (e) {
      if (attempt >= TOKEN_TRIES) throw e;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
}

// Before the session goes: this phone stops getting the last person's pushes.
beforeSignOut(async () => {
  const r = registered;
  registered = null;
  if (r) await r.repo.unregisterPush(r.token);
});

/**
 * A push was tapped: mark its message read. Right after a cold start the message may not have arrived yet, so wait
 * for it a little.
 */
export function markPushRead(repo: Repo, messageId: string, waitMs = 15_000) {
  const has = () => repo.getSnapshot().messages.some((m) => m.id === messageId);
  const mark = () => repo.markRead([messageId]).catch((e) => console.warn('[push] markRead', e));
  if (has()) return void mark();
  const timer = setTimeout(() => unsubscribe(), waitMs);
  const unsubscribe = repo.subscribe(() => {
    if (!has()) return;
    clearTimeout(timer);
    unsubscribe();
    void mark();
  });
}

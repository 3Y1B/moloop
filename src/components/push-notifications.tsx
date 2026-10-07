import * as Notifications from 'expo-notifications';
import { router, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useMe, useRepo, useRole, useSnapshot } from '@/data/hooks';
import { markPushRead, registerForPush, type PushData } from '@/data/push';
import { homeFor } from '@/lib/home';

/** Taps already handled, kept across remounts so a response is never acted on twice. */
const handled = new Set<string>();

/**
 * Pushes for whoever is signed in. Renders nothing; iOS and Android only.
 *  - Registers silently when permission is already granted (existing installs pick up a token at launch).
 *  - Asks for permission when the reason is obvious: a volunteer on duty, a lead or Mo once signed in (they get
 *    escalations whatever their duty). A festival-goer is asked after filing a request (the Ask screen).
 *  - A tapped push opens its task (a festival-goer's request), or the inbox, and marks the message read.
 */
export function PushNotifications() {
  if (Platform.OS === 'web') return null;
  return <Native />;
}

function Native() {
  useRegistration();
  usePushTaps();
  return null;
}

function useRegistration() {
  const repo = useRepo();
  const meId = useSnapshot().meId;
  const role = useRole();
  const duty = useMe()?.duty;
  useEffect(() => {
    if (!meId || !role) return;
    const prompt = role === 'team_lead' || role === 'coordinator' || (role === 'volunteer' && duty === 'on_duty');
    void registerForPush(repo, { prompt });
  }, [repo, meId, role, duty]);
}

function usePushTaps() {
  const repo = useRepo();
  const home = homeFor(useRole());
  const first = useSegments()[0] as string | undefined;
  const response = Notifications.useLastNotificationResponse();
  // The group layouts redirect by role once sign-in resolves; navigate only after that, from the right home.
  const settled = !!home && !!first && first !== 'sign-in' && (first === home || !first.startsWith('('));

  useEffect(() => {
    if (!response || !settled) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.has(id)) return;
    handled.add(id);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});

    const data = (response.notification.request.content.data ?? {}) as PushData;
    const taskId = typeof data.taskId === 'string' ? data.taskId : undefined;
    if (typeof data.messageId === 'string') markPushRead(repo, data.messageId);

    if (home === '(guest)') {
      const request = taskId ? Object.values(repo.getSnapshot().requests).find((r) => r.taskId === taskId) : undefined;
      if (request) router.push({ pathname: '/request/[id]', params: { id: request.id } });
      return;
    }
    if (taskId) router.push({ pathname: '/task/[id]', params: { id: taskId } });
    else router.push('/inbox');
  }, [response, settled, home, repo]);
}

import type { Batch } from './batch';
import type { Message, MessageKind } from './schema';

/**
 * How a message goes out as a push (docs/plans/2026-10-08-push-notifications-plan.md). Pure: the server sends it
 * (src/server/push.ts). `interruptionLevel` is iOS; Android gets the matching channel, which the app creates.
 */

export type PushLevel = 'time-sensitive' | 'active' | 'passive';

/** Android channel ids, created by the app with these exact ids. */
export const CHANNEL = { tasks: 'tasks', updates: 'updates' } as const;

const LEVEL: Record<MessageKind, PushLevel> = {
  task: 'time-sensitive',
  backup: 'time-sensitive',
  nudge: 'time-sensitive',
  escalation: 'time-sensitive',
  broadcast: 'active',
  direct: 'active',
  guest_reply: 'active',
  system: 'passive',
  moved: 'passive',
  closed: 'passive',
  arrived: 'passive',
};

/** Same words as the inbox (src/app/inbox.tsx), for messages from Moloop itself. */
const TITLE: Partial<Record<MessageKind, string>> = {
  task: 'New task',
  nudge: 'Check-in',
  moved: 'Moved',
  closed: 'Closed',
  arrived: 'Handed over',
  backup: 'Backup',
  escalation: 'Needs you',
  guest_reply: 'Festival-goer',
};

/** Expo allows 4 KiB a message; a long body is cut well short of that. */
const MAX_BODY = 1000;

export type PushContent = {
  title: string;
  body: string;
  data: { messageId: string; taskId?: string };
  sound: 'default' | null;
  priority: 'high' | 'normal';
  interruptionLevel: PushLevel;
  channelId: string;
};

export function pushFor(m: Message): PushContent {
  const level = LEVEL[m.kind] ?? 'passive';
  const fromPerson = m.kind === 'direct' || m.kind === 'broadcast' || m.fromName !== 'Moloop';
  return {
    title: fromPerson ? m.fromName : (TITLE[m.kind] ?? 'Moloop'),
    body: m.body.length > MAX_BODY ? `${m.body.slice(0, MAX_BODY - 1)}…` : m.body,
    data: m.taskId ? { messageId: m.id, taskId: m.taskId } : { messageId: m.id },
    sound: level === 'passive' ? null : 'default',
    priority: level === 'passive' ? 'normal' : 'high',
    interruptionLevel: level,
    channelId: level === 'time-sensitive' ? CHANNEL.tasks : CHANNEL.updates,
  };
}

/**
 * A batch's messages worth a push: all of them, except one that only confirms what its recipient just did (marked
 * quiet where it's sent, or sent by the recipient themselves).
 */
export const pushable = (b: Pick<Batch, 'messages' | 'quiet' | 'senders'>) =>
  b.messages.filter((m) => !b.quiet.has(m.id) && b.senders[m.id] !== m.recipientId);

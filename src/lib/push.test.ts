import { describe, expect, it } from 'vitest';

import { Batch, type World } from './batch';
import * as C from './commands';
import { pushable, pushFor } from './push';
import type { Message, Task, Volunteer } from './schema';

const NOW = 1_800_000_000_000;

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1', recipientId: 'priya', at: NOW, kind: 'task', fromName: 'Moloop', body: 'New task: Man collapsed.', read: false,
  ...over,
});

describe('pushFor: level, sound and channel per kind', () => {
  it.each([
    ['task', 'time-sensitive', 'default', 'tasks', 'New task'],
    ['backup', 'time-sensitive', 'default', 'tasks', 'Backup'],
    ['nudge', 'time-sensitive', 'default', 'tasks', 'Check-in'],
    ['escalation', 'time-sensitive', 'default', 'tasks', 'Needs you'],
    ['guest_reply', 'active', 'default', 'updates', 'Festival-goer'],
    ['system', 'passive', null, 'updates', 'Moloop'],
    ['moved', 'passive', null, 'updates', 'Moved'],
    ['closed', 'passive', null, 'updates', 'Closed'],
    ['arrived', 'passive', null, 'updates', 'Handed over'],
  ] as const)('%s → %s', (kind, level, sound, channelId, title) => {
    const p = pushFor(message({ kind, fromName: kind === 'guest_reply' ? 'Festival-goer' : 'Moloop', taskId: 't1' }));
    expect(p).toMatchObject({ interruptionLevel: level, sound, channelId, title, data: { messageId: 'm1', taskId: 't1' } });
  });

  it('a person’s direct message and broadcast are titled with their name, active with sound', () => {
    for (const kind of ['direct', 'broadcast'] as const) {
      expect(pushFor(message({ kind, fromName: 'Jordan Lee', body: 'Water at gate 2' }))).toEqual({
        title: 'Jordan Lee', body: 'Water at gate 2', data: { messageId: 'm1' }, sound: 'default', priority: 'high',
        interruptionLevel: 'active', channelId: 'updates',
      });
    }
  });

  it('a long body is cut short of Expo’s 4 KiB', () => {
    expect(pushFor(message({ body: 'x'.repeat(3000) })).body.length).toBe(1000);
  });
});

const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: [], languages: ['en'],
  zoneSlug: 'food-alley', duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
});
const task: Task = {
  id: 'collapsed', title: 'Man collapsed at the food stalls', summary: 'A man has collapsed near the food trucks.',
  category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null,
  status: 'accepted', assigneeId: 'priya', reporter: { kind: 'volunteer', name: 'Sam Smith', quote: 'guy collapsed', language: 'en' },
  handledBy: 'human', createdAt: NOW, assignedAt: NOW, etaAt: null, lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null,
  leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 1, helpers: [], resolution: null, requestId: null,
  mobilizationId: null,
};
function festival() {
  const volunteers = [person('priya'), person('sam'), person('lee', { role: 'team_lead' }), person('mo', { role: 'coordinator', teamSlug: null })];
  const world: World = {
    volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
    tasks: { [task.id]: task }, proposals: {}, requests: {}, mobilizations: {}, teams: { 'first-aid': { name: 'First Aid' } },
  };
  let n = 0;
  return new Batch(world, { now: NOW, id: (kind) => `${kind}-${++n}` });
}

describe('pushable: own actions stay quiet', () => {
  it('asking for help pushes the lead, not the “Asked … for help” echo', () => {
    const b = festival();
    C.reply(b, 'priya', task.id, 'need_help');
    expect(b.messages.map((m) => m.recipientId).sort()).toEqual(['lee', 'priya']);
    expect(pushable(b).map((m) => [m.recipientId, m.kind])).toEqual([['lee', 'escalation']]);
  });

  it('declining pushes the lead, not the “Declined” echo', () => {
    const b = festival();
    b.task({ ...task, helpers: [{ volunteerId: 'sam', status: 'notified', assignedAt: NOW, respondedAt: null }] });
    C.reply(b, 'sam', task.id, 'decline');
    expect(b.messages.some((m) => m.recipientId === 'sam' && m.body.startsWith('Declined'))).toBe(true);
    expect(pushable(b).some((m) => m.recipientId === 'sam')).toBe(false);
  });

  it('quiet never reaches the message itself', () => {
    const b = festival();
    b.send('priya', 'system', 'Declined.', { quiet: true });
    expect(b.messages[0]).not.toHaveProperty('quiet');
    expect(pushable(b)).toEqual([]);
  });

  it('a message whose sender is its recipient is skipped', () => {
    const b = festival();
    b.send('lee', 'direct', 'note to self', { fromName: 'Lee Smith', senderId: 'lee' });
    b.send('priya', 'direct', 'on my way', { fromName: 'Lee Smith', senderId: 'lee' });
    expect(pushable(b).map((m) => m.recipientId)).toEqual(['priya']);
  });
});

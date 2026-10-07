import { describe, expect, it } from 'vitest';

import { Batch, type World } from './batch';
import * as C from './commands';
import type { Triage } from './ai';
import type { GuestRequest, Task, Volunteer } from './schema';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const person = (id: string, over: Partial<Volunteer> = {}): Volunteer => ({
  id, name: `${id[0].toUpperCase()}${id.slice(1)} Smith`, role: 'volunteer', teamSlug: 'first-aid', skills: [], languages: ['en'],
  zoneSlug: 'food-alley', duty: 'on_duty', shiftEndsAt: null, phone: null, ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 'collapsed', title: 'Man collapsed at the food stalls', summary: 'A man has collapsed near the food trucks.',
  category: 'medical', priority: 'P2', teamSlug: 'first-aid', zoneSlug: 'food-alley', locationHint: null,
  status: 'accepted', assigneeId: 'priya', reporter: { kind: 'volunteer', name: 'Sam Smith', quote: 'guy collapsed by the food stalls', language: 'en' },
  handledBy: 'human', createdAt: NOW - 5 * MIN, assignedAt: NOW - 4 * MIN, etaAt: null, lastActivityAt: NOW - 4 * MIN,
  nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, helperIds: [], resolution: null,
  requestId: null, ...over,
});

const asked: GuestRequest = {
  id: 'asked', createdAt: NOW, heard: 'someone fainted near the burger truck', zoneSlug: 'food-alley', locationHint: null,
  stage: 'understanding', aiAnswer: null, taskId: null, thread: [{ from: 'guest', text: 'someone fainted near the burger truck', at: NOW }], reopenedAt: null,
};

function festival(tasks: Task[] = [task()], requests: GuestRequest[] = []) {
  const volunteers = [
    person('priya'), person('sam', { teamSlug: 'crowd' }), person('lee', { role: 'team_lead' }), person('mo', { role: 'coordinator', teamSlug: null }),
  ];
  const world: World = {
    volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    proposals: {}, requests: Object.fromEntries(requests.map((r) => [r.id, r])), teams: { 'first-aid': { name: 'First Aid' } },
  };
  let n = 0;
  return new Batch(world, { now: NOW, id: (kind) => `${kind}-${++n}` });
}

describe('updateTask: a new report about an incident already open', () => {
  it('goes on the existing task as a note, and no new task is made', () => {
    const b = festival();

    C.updateTask(b, 'collapsed', { volunteerId: 'sam' }, 'the guy by the food trucks is still down', { priority: 'P2', resolved: false });

    expect(Object.keys(b.tasks)).toEqual(['collapsed']);
    expect(b.events).toContainEqual(expect.objectContaining({ taskId: 'collapsed', kind: 'note', note: 'the guy by the food trucks is still down' }));
    expect(b.tasks.collapsed.summary).toContain('the guy by the food trucks is still down');
  });

  describe('that makes it more urgent', () => {
    const worse = () => {
      const b = festival();
      C.updateTask(b, 'collapsed', { volunteerId: 'sam' }, "he's stopped responding", { priority: 'P1', resolved: false });
      return b;
    };

    it('raises the priority', () => {
      expect(worse().tasks.collapsed.priority).toBe('P1');
    });

    it('alerts the team lead, who can send backup', () => {
      expect(worse().messages).toContainEqual(expect.objectContaining({ recipientId: 'lee', kind: 'escalation', taskId: 'collapsed' }));
    });

    it('alerts Mo too, as any P1 does', () => {
      expect(worse().messages).toContainEqual(expect.objectContaining({ recipientId: 'mo', kind: 'escalation', taskId: 'collapsed' }));
    });

    it('tells the volunteer on it out loud', () => {
      expect(worse().messages).toContainEqual(expect.objectContaining({
        recipientId: 'priya', delivery: 'spoken', taskId: 'collapsed', body: expect.stringMatching(/^Update: .*stopped responding/),
      }));
    });
  });

  describe('that says it is sorted', () => {
    const sorted = () => {
      const b = festival();
      C.updateTask(b, 'collapsed', { volunteerId: 'sam' }, 'his mate found him, he is fine', { priority: 'P3', resolved: true });
      return b;
    };

    it('leaves the task open and its priority as it was: silence never closes a task', () => {
      expect(sorted().tasks.collapsed).toMatchObject({ status: 'accepted', priority: 'P2', resolvedAt: null });
    });

    it('asks the lead whether to close it', () => {
      expect(sorted().messages).toContainEqual(expect.objectContaining({
        recipientId: 'lee', kind: 'escalation', taskId: 'collapsed', body: expect.stringMatching(/close/i),
      }));
    });

    it('tells the volunteer on it', () => {
      expect(sorted().messages).toContainEqual(expect.objectContaining({ recipientId: 'priya', taskId: 'collapsed', body: expect.stringMatching(/mate found him/) }));
    });
  });

  it('that sounds less urgent asks the lead about downgrading, without doing it', () => {
    const b = festival();

    C.updateTask(b, 'collapsed', { volunteerId: 'sam' }, "he's sitting up and talking now", { priority: 'P3', resolved: false });

    expect(b.tasks.collapsed.priority).toBe('P2');
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'lee', kind: 'escalation', body: expect.stringMatching(/P3/) }));
  });

  it('at the same urgency only tells the volunteer on it, quietly', () => {
    const b = festival();

    C.updateTask(b, 'collapsed', { volunteerId: 'sam' }, 'he is wearing a red cap', { priority: 'P2', resolved: false });

    expect(b.messages).toEqual([expect.objectContaining({ recipientId: 'priya', delivery: 'ping', body: expect.stringMatching(/red cap/) })]);
  });

  it('from a festival-goer joins their request to the task, so they see who is coming', () => {
    const b = festival([task()], [asked]);

    C.updateTask(b, 'collapsed', { requestId: 'asked' }, asked.heard, { priority: 'P2', resolved: false });

    expect(Object.keys(b.tasks)).toEqual(['collapsed']);
    expect(b.requests.asked).toMatchObject({ taskId: 'collapsed', stage: 'finding' });
  });
});

describe('the intake agent escalates a new report', () => {
  const triaged = (over: Partial<Triage> = {}): Triage => ({
    team: 'first-aid', priority: 'P3', category: 'medical', title: 'Wants the set stopped at the Oval', summary: 'Asks to stop the set.',
    zoneSlug: 'food-alley', locationHint: null, language: 'en', escalate: { level: 'lead', reason: 'Asks to stop a performance' }, ...over,
  });
  const fromGuest = (t: Triage) => {
    const b = festival([], [asked]);
    C.understand(b, 'asked', { kind: 'task', ...t });
    return { b, made: Object.values(b.tasks)[0] };
  };

  it('holds it for the lead: open, nobody assigned, no proposal for the allocator', () => {
    const { b, made } = fromGuest(triaged());

    expect(made).toMatchObject({ status: 'open', assigneeId: null, escalation: { level: 'lead', ownerId: 'lee', source: 'intake', reason: 'Asks to stop a performance' } });
    expect(Object.values(b.proposals)).toEqual([]);
    expect(b.messages).toEqual([expect.objectContaining({ recipientId: 'lee', kind: 'escalation', body: expect.stringMatching(/Needs your call/) })]);
    expect(b.requests.asked).toMatchObject({ stage: 'finding', taskId: made.id });
  });

  it('goes to Mo when it is a call for Mo', () => {
    const { b, made } = fromGuest(triaged({ escalate: { level: 'coordinator', reason: 'Evacuation asked for' } }));

    expect(made.escalation).toMatchObject({ level: 'coordinator', ownerId: 'mo' });
    expect(b.messages.map((m) => m.recipientId)).toEqual(['mo']);
  });

  it('still sends help for a P1 while the lead decides', () => {
    const { b, made } = fromGuest(triaged({ priority: 'P1', escalate: { level: 'lead', reason: 'Wants an ambulance called' } }));

    expect(made.escalation).toBeNull();
    expect(Object.values(b.proposals)).toEqual([expect.objectContaining({ taskId: made.id, status: 'pending' })]);
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'lee', body: expect.stringMatching(/Needs your call/) }));
  });

  it('leaves a plain create_task to the allocator, which sends a volunteer', () => {
    const { made } = fromGuest(triaged({ escalate: null }));

    expect(made).toMatchObject({ status: 'assigned', assigneeId: 'priya', escalation: null });
  });

  it('holds a volunteer’s own report too, and tells them who has it', () => {
    const b = festival([]);

    const { later } = C.commit(b, 'sam', { heard: 'can we stop the set', intent: { kind: 'report' } }, triaged());

    expect(Object.values(b.tasks)[0]).toMatchObject({ status: 'open', assigneeId: null, escalation: { source: 'intake' } });
    expect(later?.body).toMatch(/First Aid lead/);
  });

  describe('while nobody acts', () => {
    const heldTask = (level: 'lead' | 'coordinator', at: number) => task({
      status: 'open', assigneeId: null, assignedAt: null, priority: 'P3',
      escalation: { at, reason: 'Asks to stop a performance', level, ownerId: level === 'lead' ? 'lee' : 'mo', bumpedAt: null, response: null, source: 'intake' },
    });

    it('moves a lead’s from the lead up to Mo, and never assigns it', () => {
      const b = festival([heldTask('lead', NOW - 10 * MIN)]);

      C.schedulerStep(b);

      expect(b.tasks.collapsed).toMatchObject({ status: 'open', assigneeId: null, escalation: { level: 'coordinator', ownerId: 'mo' } });
      expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'mo', body: expect.stringMatching(/Needs your call/) }));
    });

    it('reminds Mo of Mo’s', () => {
      const b = festival([heldTask('coordinator', NOW - 10 * MIN)]);

      C.schedulerStep(b);

      expect(b.tasks.collapsed).toMatchObject({ status: 'open', assigneeId: null, lastNudgeAt: NOW });
      expect(b.messages).toEqual([expect.objectContaining({ recipientId: 'mo', body: expect.stringMatching(/Still waiting for your call/) })]);
    });

    it('can be passed to Mo by the lead, and assigning it ends the hold', () => {
      const b = festival([heldTask('lead', NOW)]);

      C.passToCoordinator(b, 'lee', 'collapsed');
      expect(b.tasks.collapsed.escalation).toMatchObject({ level: 'coordinator', ownerId: 'mo' });

      C.assign(b, 'mo', 'collapsed', 'priya');
      expect(b.tasks.collapsed).toMatchObject({ status: 'assigned', assigneeId: 'priya', escalation: null });
    });
  });
});

describe('"Problem solved?" No on an AI answer', () => {
  const answer = { kind: 'answer' as const, answer: 'Toilets are behind the Oval stage.', language: 'en' };
  const answered = () => {
    const b = festival([], [{ ...asked, heard: 'where are the toilets' }]);
    C.understand(b, 'asked', answer);
    C.guestFollowUp(b, 'asked', 'the queue is huge, any others?');
    return b;
  };

  it('goes back to Understanding with the follow-up, and no task yet', () => {
    const b = answered();

    expect(b.requests.asked).toMatchObject({ stage: 'understanding', aiAnswer: null, taskId: null, heard: 'where are the toilets. the queue is huge, any others?' });
    expect(b.requests.asked.thread.map((e) => e.from)).toEqual(['guest', 'ai', 'guest']);
    expect(Object.values(b.tasks)).toEqual([]);
  });

  it('can be answered again', () => {
    const b = answered();

    C.understand(b, 'asked', { ...answer, answer: 'There are more by the Main Entrance.' });

    expect(b.requests.asked).toMatchObject({ stage: 'answered', aiAnswer: 'There are more by the Main Entrance.' });
  });

  it('sends someone instead of repeating the same answer', () => {
    const b = answered();

    C.understand(b, 'asked', answer);

    expect(Object.values(b.tasks)).toHaveLength(1);
    expect(b.requests.asked.stage).toBe('finding');
  });
});

describe('"Problem solved?" on an AI answer', () => {
  const answer = { kind: 'answer' as const, answer: 'Toilets are behind the Oval stage.', language: 'en' };
  const answered = () => {
    const b = festival([], [{ ...asked, heard: 'where are the toilets', thread: [{ from: 'guest', text: 'where are the toilets', at: NOW }] }]);
    C.understand(b, 'asked', answer);
    return b;
  };

  it('No on its own goes back to the AI, saying so in the conversation', () => {
    const b = answered();

    C.guestFollowUp(b, 'asked');

    expect(b.requests.asked).toMatchObject({ stage: 'understanding', aiAnswer: null, taskId: null, heard: 'where are the toilets' });
    expect(b.requests.asked.thread.map((e) => [e.from, e.text])).toEqual([
      ['guest', 'where are the toilets'], ['ai', answer.answer], ['guest', C.NOT_SOLVED],
    ]);
  });

  it('what they add while the AI is still reading joins the conversation', () => {
    const b = answered();
    C.guestFollowUp(b, 'asked');

    C.guestFollowUp(b, 'asked', 'the queue is huge');

    expect(b.requests.asked).toMatchObject({ stage: 'understanding', heard: 'where are the toilets. the queue is huge' });
    expect(b.requests.asked.thread.map((e) => e.text).slice(-2)).toEqual([C.NOT_SOLVED, 'the queue is huge']);
  });

  it('Yes closes it for good', () => {
    const b = answered();

    C.guestSolved(b, 'asked');
    C.guestFollowUp(b, 'asked');

    expect(b.requests.asked.stage).toBe('sorted');
    expect(b.requests.asked.thread).toHaveLength(2);
  });

  it('still needing help after Yes goes back to the AI', () => {
    const b = answered();
    C.guestSolved(b, 'asked');

    C.guestReopen(b, 'asked');

    expect(b.requests.asked).toMatchObject({ stage: 'understanding', aiAnswer: null, reopenedAt: NOW });
    C.understand(b, 'asked', answer);
    expect(b.requests.asked.stage).toBe('finding');
  });
});

import { describe, expect, it } from 'vitest';

import { Batch, type World } from './batch';
import * as C from './commands';
import type { Triage } from './ai';
import { isBusy } from './lifecycle';
import type { GuestRequest, Mobilization, Proposal, Task, Volunteer } from './schema';

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
  nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null, resolvedAt: null, escalation: null, requiredCount: 1, helpers: [], resolution: null,
  requestId: null, mobilizationId: null, ...over,
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
    proposals: {}, requests: Object.fromEntries(requests.map((r) => [r.id, r])), mobilizations: {}, teams: { 'first-aid': { name: 'First Aid' } },
  };
  let n = 0;
  return new Batch(world, { now: NOW, id: (kind) => `${kind}-${++n}` });
}

describe('manual helpers and automatic recruitment share one assignment', () => {
  const ready = (over: Partial<Task> = {}) => task({ status: 'open', assigneeId: null, assignedAt: null,
    category: 'facilities', requiredSkills: ['radio-trained'], ...over });
  function crew(initial: Task) {
    const b = festival([initial]);
    for (const id of ['owner', 'selected', 'other', 'third'])
      b.volunteers[id] = person(id, { skills: ['radio-trained'] });
    return b;
  }

  it('deduplicates manual picks, reserves them before topping up and notifies each once', () => {
    const initial = ready({ requiredCount: 3, mobilizationId: 'mobilization' });
    const b = crew(initial);
    C.assign(b, 'mo', initial.id, 'owner', 'assigned', ['owner', 'selected', 'selected']);

    expect(b.tasks[initial.id].helpers).toHaveLength(2);
    expect(b.tasks[initial.id].helpers[0]).toEqual({ volunteerId: 'selected', status: 'notified',
      assignedAt: NOW, respondedAt: null });
    expect(new Set(b.tasks[initial.id].helpers.map((entry) => entry.volunteerId)).size).toBe(2);
    expect(b.tasks[initial.id].requiredCount).toBe(3);
    for (const helper of b.tasks[initial.id].helpers) {
      expect(b.events.filter((entry) => entry.kind === 'helper_added' && entry.taskId === initial.id &&
        entry.text.includes(b.volunteers[helper.volunteerId].name))).toHaveLength(1);
      expect(b.messages.filter((message) => message.kind === 'backup' &&
        message.recipientId === helper.volunteerId)).toHaveLength(1);
    }
  });

  it('sets ordinary manual demand without pre-accepting someone else or creating a second notification', () => {
    const initial = ready();
    const b = crew(initial);
    C.assign(b, 'mo', initial.id, 'owner', 'assigned', ['selected']);
    expect(b.tasks[initial.id]).toMatchObject({ requiredCount: 2,
      helpers: [{ volunteerId: 'selected', status: 'notified' }] });
    C.reply(b, 'selected', initial.id, 'accept');
    expect(b.tasks[initial.id].helpers[0]).toMatchObject({ status: 'accepted', respondedAt: NOW });
    expect(b.messages.filter((message) => message.kind === 'backup' &&
      message.recipientId === 'selected')).toHaveLength(1);
  });

  it.each([
    { role: 'team_lead' as const }, { duty: 'on_break' as const }, { skills: [] }, { shiftEndsAt: NOW },
  ])('rejects an ineligible explicit helper before any side effect: %j', (over) => {
    const initial = ready();
    const b = crew(initial);
    b.volunteers.selected = person('selected', { skills: ['radio-trained'], ...over });
    expect(() => C.assign(b, 'mo', initial.id, 'owner', 'assigned', ['selected'])).toThrow(/Selected helpers/);
    expect(b.tasks[initial.id]).toEqual(initial);
    expect(b.messages).toEqual([]);
    expect(b.events).toEqual([]);
  });

  it('takes a helper from another team on an ordinary task, not on a mobilization step', () => {
    const ordinary = crew(ready());
    ordinary.volunteers.selected = person('selected', { skills: ['radio-trained'], teamSlug: 'crowd' });
    C.assign(ordinary, 'mo', ready().id, 'owner', 'assigned', ['selected']);
    expect(ordinary.tasks[ready().id].helpers).toMatchObject([{ volunteerId: 'selected' }]);

    const step = ready();
    const b = crew({ ...step, mobilizationId: 'storm' });
    b.volunteers.selected = person('selected', { skills: ['radio-trained'], teamSlug: 'crowd' });
    expect(() => C.assign(b, 'mo', step.id, 'owner', 'assigned', ['selected'])).toThrow(/Selected helpers/);
  });

  it('rejects a helper busy on another task and an unknown helper without partial writes', () => {
    const initial = ready();
    const b = crew(initial);
    b.tasks.busy = task({ id: 'busy', assigneeId: 'selected' });
    for (const helperId of ['selected', 'unknown']) {
      expect(() => C.assign(b, 'mo', initial.id, 'owner', 'assigned', [helperId])).toThrow();
      expect(b.tasks[initial.id]).toEqual(initial);
      expect(b.messages).toEqual([]);
      expect(b.events).toEqual([]);
    }
  });

  it('rejects stale named reservations for a queued owner, while no-helper assignments still queue', () => {
    const initial = ready();
    const b = crew(initial);
    b.tasks.busy = task({ id: 'busy', assigneeId: 'owner' });
    expect(() => C.assign(b, 'mo', initial.id, 'owner', 'assigned', ['selected'])).toThrow(/free owner/);
    expect(b.tasks[initial.id]).toEqual(initial);
    C.assign(b, 'mo', initial.id, 'owner');
    expect(b.tasks[initial.id]).toMatchObject({ status: 'queued', helpers: [] });
  });

  it('does not release a selected retained helper when moving the owner', () => {
    const slot = { volunteerId: 'selected', status: 'accepted' as const, assignedAt: NOW - MIN, respondedAt: NOW - MIN };
    const initial = ready({ status: 'accepted', assigneeId: 'priya', requiredCount: 2, helpers: [slot] });
    const b = crew(initial);
    C.assign(b, 'mo', initial.id, 'owner', 'assigned', ['selected']);
    expect(b.tasks[initial.id].helpers).toEqual([slot]);
    expect(b.messages.filter((message) => message.recipientId === 'selected' && message.kind === 'moved')).toEqual([]);
    expect(b.messages.filter((message) => message.recipientId === 'selected' && message.kind === 'backup')).toEqual([]);
    expect(b.events.filter((entry) => entry.kind === 'helper_added')).toEqual([]);
  });

  it('retains an eligible automatic helper without releasing or notifying them again', () => {
    const slot = { volunteerId: 'selected', status: 'accepted' as const, assignedAt: NOW - MIN, respondedAt: NOW - MIN };
    const initial = ready({ status: 'accepted', assigneeId: 'priya', requiredCount: 2, helpers: [slot], mobilizationId: 'mobilization' });
    const b = crew(initial);
    delete b.volunteers.other;
    delete b.volunteers.third;
    C.assign(b, 'mo', initial.id, 'owner');
    expect(b.tasks[initial.id].helpers).toEqual([slot]);
    expect(b.messages.filter((message) => message.recipientId === 'selected')).toEqual([]);
    expect(b.events.filter((entry) => entry.kind === 'helper_added')).toEqual([]);
  });

  it('leaves a visible staffing gap rather than automatically recruit busy, off-team or unqualified helpers', () => {
    const initial = ready({ requiredCount: 3, mobilizationId: 'storm' });
    const b = crew(initial);
    b.volunteers.selected = person('selected', { skills: [] });
    b.volunteers.other = person('other', { skills: ['radio-trained'], teamSlug: 'crowd' });
    b.tasks.busy = task({ id: 'busy', assigneeId: 'third' });
    C.assign(b, 'mo', initial.id, 'owner');
    expect(b.tasks[initial.id]).toMatchObject({ requiredCount: 3, helpers: [] });
  });

  it('passes explicit helpers through ordinary proposal approval', () => {
    const initial = ready();
    const b = crew(initial);
    b.proposals.pick = { id: 'pick', taskId: initial.id, candidates: [{ volunteerId: 'owner', rationale: 'free', distanceM: 0 }], helperIds: [],
      createdAt: NOW, autoAssignAt: NOW + MIN, status: 'pending', volunteerId: null, decidedById: null, decidedAt: null };
    C.approve(b, 'mo', 'pick', undefined, ['selected']);
    expect(b.proposals.pick.status).toBe('approved');
    expect(b.tasks[initial.id].helpers).toMatchObject([{ volunteerId: 'selected', status: 'notified' }]);
  });
});

describe('tell_guest intent updates its task instead of filing an incident', () => {
  it('sends the volunteer message and resets only the task update clock', () => {
    const initial = task({ requestId: asked.id, nudgeCount: 2, lastNudgeAt: NOW - MIN, leadAlertedAt: NOW - MIN });
    const request = { ...asked, taskId: initial.id, stage: 'coming' as const };
    const b = festival([initial], [request]);
    expect(C.commit(b, 'priya', { heard: 'tell them I am arriving',
      intent: { kind: 'tell_guest', taskId: initial.id, text: 'I am arriving.' } })).toEqual({ confirmation: 'Sent to the festival-goer' });
    expect(b.requests[request.id].thread.at(-1)).toMatchObject({ from: 'staff', text: 'I am arriving.', at: NOW });
    expect(b.tasks[initial.id]).toMatchObject({ lastActivityAt: NOW, nudgeCount: 0, lastNudgeAt: null, leadAlertedAt: null });
    expect(Object.keys(b.tasks)).toEqual([initial.id]);
  });
});

describe('a scoped scheduler pass retains the full world', () => {
  it('nudges its named Task only, exactly once across repeated passes', () => {
    const target = task({ id: 'target', status: 'assigned' });
    const unrelated = task({ id: 'unrelated', status: 'assigned', assigneeId: 'sam' });
    const b = festival([target, unrelated]);
    C.schedulerStep(b, ['target']);
    C.schedulerStep(b, ['target']);
    expect(b.tasks.unrelated).toEqual(unrelated);
    expect(b.tasks.target.lastNudgeAt).toBe(NOW);
    expect(b.events.filter((event) => event.kind === 'nudged')).toHaveLength(1);
    expect(b.messages.filter((message) => message.kind === 'nudge')).toHaveLength(1);
  });

  it('still sees an unrelated active Task when deciding whether a candidate is busy', () => {
    const occupied = task({ id: 'occupied' });
    const target = task({ id: 'target', status: 'open', assigneeId: null, assignedAt: null });
    const b = festival([occupied, target]);
    b.proposals.pick = { id: 'pick', taskId: 'target', candidates: [], helperIds: [], createdAt: NOW - MIN,
      autoAssignAt: NOW - 1, status: 'pending', volunteerId: null, decidedById: null, decidedAt: null };
    b.proposals.other = { ...b.proposals.pick, id: 'other', taskId: 'occupied' };
    C.schedulerStep(b, ['target']);
    expect(b.tasks.occupied).toEqual(occupied);
    expect(b.tasks.target).toMatchObject({ status: 'queued', assigneeId: 'priya' });
    expect(b.proposals.other.status).toBe('pending');
  });
});

describe('updateTask: a new report about an incident already open', () => {
  it('does not let a stale model match join an incident report to a Mobilization operation', () => {
    const operation = task({ mobilizationId: 'mobilization', mobilizationStepKey: 'water-patrol' });
    const b = festival([operation], [asked]);
    C.understand(b, asked.id, {
      kind: 'task', team: 'first-aid', priority: 'P3', category: 'medical',
      title: 'A separate fainting report', summary: asked.heard, zoneSlug: 'food-alley',
      locationHint: null, language: 'en', speakerNeeded: null, firstAidNeeded: null, escalate: null,
    }, { taskId: operation.id, read: { priority: 'P1', resolved: false } });
    expect(b.tasks[operation.id]).toEqual(operation);
    expect(b.requests[asked.id].taskId).not.toBe(operation.id);
    expect(Object.keys(b.tasks)).toHaveLength(2);
  });

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
    zoneSlug: 'food-alley', locationHint: null, language: 'en', speakerNeeded: null, firstAidNeeded: false, escalate: { level: 'lead', reason: 'Asks to stop a performance' }, ...over,
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

  it('answers the same again rather than sending someone: the classifier decides that', () => {
    const b = answered();

    C.understand(b, 'asked', answer);

    expect(Object.values(b.tasks)).toEqual([]);
    expect(b.requests.asked.stage).toBe('answered');
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
    expect(b.requests.asked.stage).toBe('answered');
  });
});

describe('the picker’s read of a P1/P2 proposal', () => {
  const open = task({ status: 'open', assigneeId: null, assignedAt: null, priority: 'P1' });
  const busyOn = task({ id: 'spill', status: 'assigned', assigneeId: 'kai', priority: 'P3', category: 'facilities', teamSlug: 'ops' });
  const candidate = (id: string) => ({ volunteerId: id, rationale: `free · ${id}`, distanceM: 50 });
  const proposal: Proposal = {
    id: 'p1', taskId: 'collapsed', candidates: [candidate('priya'), candidate('tom')], helperIds: [], createdAt: NOW,
    autoAssignAt: NOW + 30_000, status: 'pending', volunteerId: null, decidedById: null, decidedAt: null,
  };
  const world = (over: Partial<Proposal> = {}, now = NOW) => {
    const volunteers = [
      person('priya'), person('tom'), person('ana'), person('kai'), person('lee', { role: 'team_lead' }), person('mo', { role: 'coordinator', teamSlug: null }),
    ];
    const w: World = {
      volunteers: Object.fromEntries(volunteers.map((v) => [v.id, v])),
      tasks: { collapsed: open, spill: busyOn },
      proposals: { p1: { ...proposal, ...over } }, requests: {}, mobilizations: {}, teams: { 'first-aid': { name: 'First Aid' } },
    };
    let n = 0;
    return new Batch(w, { now, id: (kind) => `${kind}-${++n}` });
  };

  it('puts its best first and sends the next free ones along, up to how many it needs', () => {
    const b = world();

    C.rerank(b, 'p1', [candidate('ana'), candidate('kai'), candidate('priya'), candidate('tom')], 3);

    expect(b.proposals.p1.candidates.map((c) => c.volunteerId)).toEqual(['ana', 'kai', 'priya', 'tom']);
    // Kai is busy on the spill, so the two going with Ana are the next free ones.
    expect(b.proposals.p1.helperIds).toEqual(['priya', 'tom']);
    expect(b.events).toContainEqual(expect.objectContaining({ kind: 'proposed', text: 'Suggested Ana Smith, Priya Smith and Tom Smith, waiting for approval' }));
  });

  it('changes nothing once someone has decided', () => {
    const b = world({ status: 'approved', volunteerId: 'priya' });

    C.rerank(b, 'p1', [candidate('ana')], 2);

    expect(b.proposals.p1.candidates.map((c) => c.volunteerId)).toEqual(['priya', 'tom']);
    expect(b.events).toEqual([]);
  });

  it('approving the pick sends whoever it said goes along', () => {
    const b = world({ helperIds: ['tom'] });

    C.approve(b, 'lee', 'p1');

    expect(b.tasks.collapsed).toMatchObject({ assigneeId: 'priya', helpers: [expect.objectContaining({ volunteerId: 'tom', status: 'notified' })] });
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'tom', kind: 'backup', body: 'Help Priya: Man collapsed at the food stalls.' }));
  });

  it('approving someone else sends them alone', () => {
    const b = world({ helperIds: ['tom'] });

    C.approve(b, 'lee', 'p1', 'ana');

    expect(b.tasks.collapsed).toMatchObject({ assigneeId: 'ana', helpers: [] });
  });

  it('nobody approving in time assigns the pick and the helpers it said', () => {
    const b = world({ helperIds: ['tom'] }, NOW + 31_000);

    C.schedulerStep(b);

    expect(b.proposals.p1.status).toBe('auto_assigned');
    expect(b.tasks.collapsed).toMatchObject({ assigneeId: 'priya', helpers: [expect.objectContaining({ volunteerId: 'tom', status: 'notified' })] });
  });
});

describe('guestAddDetail: a festival-goer adds detail in their own language', () => {
  const following = () => festival(
    [task({ requestId: 'asked', reporter: { kind: 'festivalgoer', quote: 'Mi amigo se desmayó', language: 'es', english: 'My friend fainted' } })],
    [{ ...asked, taskId: 'collapsed', stage: 'finding' }],
  );

  it('reaches the summary, the log and the volunteer in English, with their own words kept on the log', () => {
    const b = following();
    C.guestAddDetail(b, 'asked', 'Lleva una camiseta roja', { worse: false, english: 'He is wearing a red shirt' });

    expect(b.tasks.collapsed.summary).toMatch(/Update: He is wearing a red shirt$/);
    expect(b.events).toContainEqual(expect.objectContaining({
      taskId: 'collapsed', kind: 'note', text: 'Detail from the festival-goer: “He is wearing a red shirt”', note: 'Lleva una camiseta roja',
    }));
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'priya', body: 'Update: “He is wearing a red shirt”' }));
    expect(b.requests.asked.thread).toContainEqual(expect.objectContaining({ from: 'guest', text: 'Lleva una camiseta roja' }));
  });

  it('goes in as typed when nothing translated it', () => {
    const b = following();
    C.guestAddDetail(b, 'asked', 'Lleva una camiseta roja', { worse: false });

    expect(b.tasks.collapsed.summary).toMatch(/Update: Lleva una camiseta roja$/);
    expect(b.events).toContainEqual(expect.objectContaining({ kind: 'note', text: 'Detail from the festival-goer', note: 'Lleva una camiseta roja' }));
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'priya', body: 'Update: “Lleva una camiseta roja”' }));
  });
});

describe('a mobilization step stays staffed (audit D1-D6, S1)', () => {
  const plan = (peopleNeeded: number): Mobilization => ({
    id: 'storm', title: 'Severe storm, Oval Stage', status: 'proposed', rationale: 'Wind over the limit', relatedPlaybooks: [],
    urgency: 'P1', zoneSlug: 'food-alley', evidence: null, analysisRunId: null, playbookSlug: null, createdAt: NOW,
    decidedById: null, decidedAt: null,
    steps: [{ stepKey: 'cover', teamSlug: 'first-aid', peopleNeeded, reason: 'Ready for injuries', candidates: [], title: 'Stand by at the stage' }],
  });
  /** First Aid: `free` people free, plus priya busy on the collapse. */
  function venue(free: string[], peopleNeeded = 4) {
    const b = festival([task()]);
    for (const id of free) b.volunteers[id] = person(id);
    b.mobilizations.storm = plan(peopleNeeded);
    return b;
  }
  const step = (b: Batch) => b.all().find((t) => t.mobilizationId === 'storm')!;

  it('approved with 2 free of 4 needed: 2 go, the other 2 join as people free up', () => {
    const b = venue(['ana', 'kai']);
    C.approveMobilization(b, 'mo', 'storm');
    expect(step(b).assigneeId).toBeTruthy();
    expect(step(b).helpers).toHaveLength(1);

    C.reply(b, 'priya', 'collapsed', 'done');

    expect(step(b).helpers.map((h) => h.volunteerId)).toContain('priya');
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: 'priya', kind: 'backup' }));
  });

  it('a step nobody could take is taken by the next person to free up', () => {
    const b = venue([], 1);
    C.approveMobilization(b, 'mo', 'storm');
    expect(step(b)).toMatchObject({ status: 'open', assigneeId: null });

    C.reply(b, 'priya', 'collapsed', 'done');

    expect(step(b)).toMatchObject({ status: 'assigned', assigneeId: 'priya' });
  });

  it('a helper cannot mark it done before accepting', () => {
    const b = venue(['ana', 'kai'], 2);
    C.approveMobilization(b, 'mo', 'storm');
    const t = step(b);
    const helper = t.helpers[0].volunteerId;
    C.reply(b, t.assigneeId!, t.id, 'accept');

    expect(() => C.reply(b, helper, t.id, 'done')).toThrow(/Accept/);
    expect(step(b).status).toBe('accepted');
    C.reply(b, helper, t.id, 'accept');
    C.reply(b, helper, t.id, 'done');
    expect(step(b).status).toBe('resolved');
  });

  it('a helper declining is freed and the slot goes to someone else', () => {
    const b = venue(['ana', 'kai', 'tom'], 2);
    C.approveMobilization(b, 'mo', 'storm');
    const helper = step(b).helpers[0].volunteerId;

    C.reply(b, helper, step(b).id, 'decline');

    expect(step(b).helpers).toHaveLength(1);
    expect(step(b).helpers[0].volunteerId).not.toBe(helper);
  });

  it('the owner declining hands it to a helper who already accepted', () => {
    const b = venue(['ana', 'kai'], 2);
    C.approveMobilization(b, 'mo', 'storm');
    const t = step(b);
    const owner = t.assigneeId!;
    const helper = t.helpers[0].volunteerId;
    C.reply(b, helper, t.id, 'accept');

    C.reply(b, owner, t.id, 'decline');

    expect(step(b)).toMatchObject({ status: 'accepted', assigneeId: helper, helpers: [] });
    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: helper, kind: 'task' }));
  });

  it('the owner declining with nobody accepted lets the helpers go and restaffs the step', () => {
    const b = venue(['ana', 'kai', 'tom'], 2);
    C.approveMobilization(b, 'mo', 'storm');
    const t = step(b);
    const owner = t.assigneeId!;
    const asked = t.helpers[0].volunteerId;

    C.reply(b, owner, t.id, 'decline');

    expect(b.messages).toContainEqual(expect.objectContaining({ recipientId: asked, body: expect.stringMatching(/You're off/) }));
    expect(step(b).assigneeId).toBeTruthy();
    expect(step(b).assigneeId).not.toBe(owner);
  });

  it('stand down cancels its open tasks and frees their people', () => {
    const b = venue(['ana', 'kai'], 2);
    C.approveMobilization(b, 'mo', 'storm');
    const on = b.onIt(step(b));

    C.standDown(b, 'mo', 'storm', 'stood_down');

    expect(step(b)).toMatchObject({ status: 'cancelled', resolution: 'cancelled' });
    expect(b.mobilizations.storm.status).toBe('stood_down');
    for (const id of on) expect(isBusy(b.all(), id)).toBe(false);
  });

  it('is over once all its tasks are', () => {
    const b = venue(['ana'], 1);
    C.approveMobilization(b, 'mo', 'storm');
    const t = step(b);
    C.reply(b, t.assigneeId!, t.id, 'accept');
    C.reply(b, t.assigneeId!, t.id, 'done');

    C.schedulerStep(b);

    expect(b.mobilizations.storm.status).toBe('stood_down');
  });
});

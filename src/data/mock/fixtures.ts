import type { Message, Priority, Task, TaskEvent, Team, TeamSlug, Volunteer, Zone } from '@/lib/schema';
import { clockTime } from '@/lib/format';
import type { Snapshot } from '../repo';

const MIN = 60_000;

export const TEAMS: Team[] = [
  { slug: 'first-aid', name: 'First Aid & Heat', color: '#FF3B30', sf: 'cross.case.fill', md: 'medical_services' },
  { slug: 'welfare', name: 'Welfare & Lost Kids', color: '#FF9500', sf: 'figure.and.child.holdinghands', md: 'family_restroom' },
  { slug: 'crowd', name: 'Crowd & Gates', color: '#AF52DE', sf: 'person.3.fill', md: 'groups' },
  { slug: 'security', name: 'Security Liaison', color: '#34C759', sf: 'shield.lefthalf.filled', md: 'shield' },
  { slug: 'info', name: 'Access & Info', color: '#30B0C7', sf: 'info.circle.fill', md: 'info' },
  { slug: 'artist', name: 'Artist Liaison', color: '#FF2D55', sf: 'music.mic', md: 'mic' },
  { slug: 'vendors', name: 'Food & Vendors', color: '#A2845E', sf: 'fork.knife', md: 'restaurant' },
  { slug: 'ops', name: 'Tech & Logistics', color: '#5856D6', sf: 'wrench.and.screwdriver.fill', md: 'build' },
];

export const ZONES: Zone[] = [
  { slug: 'gate-a', name: 'Gate A (Main)' },
  { slug: 'gate-b', name: 'Gate B (Tram)' },
  { slug: 'lawn-stage', name: 'Lawn Stage' },
  { slug: 'river-stage', name: 'River Stage' },
  { slug: 'water-1', name: 'Water Station 1' },
  { slug: 'water-2', name: 'Water Station 2' },
  { slug: 'first-aid-hq', name: 'First Aid Post' },
  { slug: 'food-alley', name: 'Food Alley' },
  { slug: 'info-tent', name: 'Info Tent' },
  { slug: 'backstage', name: 'Backstage' },
];

const vol = (
  id: string, name: string, teamSlug: TeamSlug | null, zoneSlug: string,
  extra: Partial<Volunteer> = {},
): Volunteer => ({
  id, name, teamSlug, zoneSlug, role: 'volunteer', skills: [], languages: ['en'], duty: 'on_duty', shiftEndsAt: null, ...extra,
});

export const ME_ID = 'v-priya';

const shiftEndFor = (now: number) => now + 2 * 60 * MIN + 15 * MIN;

function volunteers(now: number): Volunteer[] {
  const shiftEnd = shiftEndFor(now);
  return [
    vol('v-mo', 'Mo', null, 'info-tent', { role: 'coordinator' }),
    vol('v-priya', 'Priya Shah', 'first-aid', 'lawn-stage', { skills: ['first-aid-cert', 'radio-trained'], languages: ['en', 'hi'], shiftEndsAt: shiftEnd }),
    vol('v-jordan', 'Jordan Lee', 'first-aid', 'first-aid-hq', { role: 'team_lead', skills: ['first-aid-cert'] }),
    vol('v-tom', 'Tom Becker', 'first-aid', 'river-stage', { skills: ['first-aid-cert'], shiftEndsAt: shiftEnd }),
    vol('v-linh', 'Linh Tran', 'welfare', 'food-alley', { skills: ['wwcc', 'multilingual'], languages: ['en', 'vi'] }),
    vol('v-sofia', 'Sofia Russo', 'welfare', 'info-tent', { role: 'team_lead', skills: ['wwcc'] }),
    vol('v-kai', 'Kai Walker', 'crowd', 'gate-a', { skills: ['crowd-control', 'radio-trained'] }),
    vol('v-amara', 'Amara Okafor', 'crowd', 'gate-b', { role: 'team_lead', skills: ['crowd-control'] }),
    vol('v-dev', 'Dev Patel', 'security', 'river-stage'),
    vol('v-noah', 'Noah Kim', 'info', 'info-tent', { languages: ['en', 'ko'] }),
    vol('v-elena', 'Elena García', 'artist', 'backstage', { languages: ['en', 'es'] }),
    vol('v-sam', 'Sam O’Brien', 'vendors', 'food-alley', { skills: ['rsa'] }),
    vol('v-rui', 'Rui Chen', 'ops', 'lawn-stage', { skills: ['radio-trained'], duty: 'on_break' }),
  ];
}

const task = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'summary' | 'priority' | 'createdAt'>): Task => ({
  category: 'other', teamSlug: null, zoneSlug: null, locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: t.summary, language: 'en' }, handledBy: 'human',
  assignedAt: null, etaAt: null, lastActivityAt: t.createdAt, nudgeCount: 0, lastNudgeAt: null,
  leadAlertedAt: null, resolvedAt: null, ...t,
});

function tasks(now: number): Task[] {
  return [
    task({
      id: 't-heat', priority: 'P2', category: 'heat', teamSlug: 'first-aid', zoneSlug: 'water-2',
      title: 'Dizzy man at Water Station 2',
      summary: 'Man in his 60s, flushed and dizzy, sitting in the shade by the refill taps. Conscious and talking.',
      locationHint: 'Shade sail behind the refill taps',
      reporter: { kind: 'festivalgoer', quote: 'Có một ông chú bị chóng mặt, mặt đỏ lắm, đang ngồi ở trạm nước số 2', language: 'vi' },
      status: 'assigned', assigneeId: ME_ID, createdAt: now - 70_000, assignedAt: now - 40_000, lastActivityAt: now - 40_000,
    }),
    task({
      id: 't-kit', priority: 'P3', category: 'facilities', teamSlug: 'first-aid', zoneSlug: 'lawn-stage',
      title: 'Restock first aid bag at Lawn Stage',
      summary: 'Bag at the Lawn Stage side tent is low on gauze, saline and ice packs.',
      locationHint: 'Side tent, stage left',
      reporter: { kind: 'volunteer', name: 'Tom Becker', quote: 'Lawn stage kit is nearly out of gauze and ice packs', language: 'en' },
      status: 'queued', assigneeId: ME_ID, createdAt: now - 6 * MIN,
    }),
    task({
      id: 't-knee', priority: 'P3', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'food-alley',
      title: 'Grazed knee at Food Alley', summary: 'Child tripped on cable cover, small graze. Parent present.',
      status: 'resolved', assigneeId: ME_ID, createdAt: now - 58 * MIN, assignedAt: now - 57 * MIN, resolvedAt: now - 49 * MIN, lastActivityAt: now - 49 * MIN,
    }),
    task({
      id: 't-sting', priority: 'P2', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'gate-b',
      title: 'Wasp sting near Gate B', summary: 'Adult stung on the hand, no known allergy, some swelling.',
      status: 'resolved', assigneeId: ME_ID, createdAt: now - 95 * MIN, assignedAt: now - 94 * MIN, resolvedAt: now - 81 * MIN, lastActivityAt: now - 81 * MIN,
    }),
    // Other people's work, for the lead board later.
    task({
      id: 't-child', priority: 'P1', category: 'lost_child', teamSlug: 'welfare', zoneSlug: 'food-alley',
      title: 'Lost child, 6, red hat, Food Alley', summary: 'Mother separated from son (6, red bucket hat, dinosaur shirt) near the dumpling stall.',
      status: 'accepted', assigneeId: 'v-linh', createdAt: now - 4 * MIN, assignedAt: now - 4 * MIN, etaAt: now + 2 * MIN, lastActivityAt: now - 3 * MIN,
    }),
    task({
      id: 't-gate', priority: 'P2', category: 'crowding', teamSlug: 'crowd', zoneSlug: 'gate-a',
      title: 'Queue backing onto road at Gate A', summary: 'Entry queue spilling past the barriers onto the footpath edge.',
      status: 'in_progress', assigneeId: 'v-kai', createdAt: now - 12 * MIN, assignedAt: now - 11 * MIN, etaAt: now + 4 * MIN, lastActivityAt: now - 5 * MIN,
    }),
    task({
      id: 't-gas', priority: 'P2', category: 'vendor', teamSlug: 'vendors', zoneSlug: 'food-alley',
      title: 'Vendor gas bottle smell at stall 14', summary: 'Stallholder reports a gas smell near their BBQ. Stall has paused cooking.',
      status: 'open', createdAt: now - 1 * MIN,
    }),
    task({
      id: 't-rider', priority: 'P3', category: 'artist', teamSlug: 'artist', zoneSlug: 'backstage',
      title: 'Artist rider: 2 more towels for green room B', summary: 'Headliner tour manager asking for extra towels before 5:30pm set.',
      status: 'accepted', assigneeId: 'v-elena', createdAt: now - 9 * MIN, assignedAt: now - 9 * MIN, etaAt: now + 11 * MIN, lastActivityAt: now - 8 * MIN,
    }),
  ];
}

const ev = (id: string, taskId: string, at: number, kind: TaskEvent['kind'], text: string, actor: TaskEvent['actor'] = { kind: 'system' }): TaskEvent =>
  ({ id, taskId, at, kind, text, actor });

function events(now: number): TaskEvent[] {
  const triage = { kind: 'agent' as const, name: 'Triage' };
  const priya = { kind: 'human' as const, id: ME_ID, name: 'Priya Shah' };
  return [
    ev('e1', 't-heat', now - 70_000, 'created', 'Reported by a festival-goer in Vietnamese, translated', triage),
    ev('e2', 't-heat', now - 40_000, 'assigned', 'Assigned to Priya: nearest first aider, free, 180 m away', triage),
    ev('e3', 't-kit', now - 6 * MIN, 'created', 'Reported by Tom Becker', triage),
    ev('e4', 't-kit', now - 6 * MIN, 'queued', 'Queued for Priya (busy with another task)', triage),
    ev('e5', 't-knee', now - 58 * MIN, 'created', 'Reported at Info Tent', triage),
    ev('e6', 't-knee', now - 57 * MIN, 'assigned', 'Assigned to Priya', triage),
    { ...ev('e7', 't-knee', now - 56 * MIN, 'reply', 'Accepted', priya), reply: 'accept' },
    { ...ev('e8', 't-knee', now - 49 * MIN, 'resolved', 'Done', priya), reply: 'done' },
    ev('e9', 't-sting', now - 95 * MIN, 'created', 'Reported by a festival-goer', triage),
    ev('e10', 't-sting', now - 94 * MIN, 'assigned', 'Assigned to Priya', triage),
    { ...ev('e11', 't-sting', now - 81 * MIN, 'resolved', 'Done', priya), reply: 'done' },
    ev('e12', 't-child', now - 4 * MIN, 'created', 'Lost child report, Welfare lead has ownership', triage),
    ev('e13', 't-gate', now - 12 * MIN, 'created', 'Reported by Gate A volunteer', triage),
    ev('e14', 't-gas', now - 1 * MIN, 'created', 'Reported by stallholder', triage),
  ];
}

function messages(now: number): Message[] {
  return [
    {
      id: 'm1', recipientId: ME_ID, at: now - 40_000, kind: 'task', fromName: 'Moloop', taskId: 't-heat', delivery: 'spoken', read: false,
      body: 'New task: dizzy man at Water Station 2, in the shade by the refill taps. Conscious and talking.',
    },
    {
      id: 'm2', recipientId: ME_ID, at: now - 11 * MIN, kind: 'direct', fromName: 'Jordan Lee', read: false,
      body: 'When you get a sec, grab a fresh bag from the First Aid Post. Lawn kit is running low.',
    },
    {
      id: 'm3', recipientId: ME_ID, at: now - 34 * MIN, kind: 'broadcast', fromName: 'Mo', read: true,
      body: 'Heat plan is ON. 34°C and climbing. Water stations fully staffed, rotate every 45 min, drink something now.',
    },
    {
      id: 'm4', recipientId: ME_ID, at: now - 80 * MIN, kind: 'system', fromName: 'Moloop', read: true,
      body: `You’re checked in for First Aid & Heat until ${clockTime(shiftEndFor(now))}. Reply “copy”, “on my way”, “done” or “need help” by voice or tap.`,
    },
  ];
}

export function initialSnapshot(now: number): Snapshot {
  const byKey = <T, K extends keyof T>(xs: T[], k: K) => Object.fromEntries(xs.map((x) => [x[k] as string, x]));
  return {
    status: 'ready',
    now,
    meId: ME_ID,
    teams: byKey(TEAMS, 'slug'),
    zones: byKey(ZONES, 'slug'),
    volunteers: byKey(volunteers(now), 'id'),
    tasks: byKey(tasks(now), 'id'),
    events: events(now),
    messages: messages(now),
  };
}

/** Canned reports for "simulate incoming task" in the dev panel. */
export const INCOMING: Record<Priority, Omit<Task, 'id' | 'createdAt' | 'lastActivityAt' | 'status' | 'assigneeId' | 'assignedAt' | 'etaAt' | 'nudgeCount' | 'lastNudgeAt' | 'leadAlertedAt' | 'resolvedAt'>[]> = {
  P1: [{
    priority: 'P1', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'river-stage', handledBy: 'human',
    title: 'Woman collapsed, River Stage front-left',
    summary: 'Woman in her 20s collapsed in the crowd, not responding to her friends. Friends are with her.',
    locationHint: 'Front-left of the barrier, near the speaker stack',
    reporter: { kind: 'festivalgoer', quote: 'my friend just collapsed and she’s not answering us, front left of river stage', language: 'en' },
  }],
  P2: [{
    priority: 'P2', category: 'heat', teamSlug: 'first-aid', zoneSlug: 'gate-a', handledBy: 'human',
    title: 'Teen fainted in queue at Gate A',
    summary: 'Teenage girl fainted in the entry queue, now sitting up. Gate volunteer is with her.',
    locationHint: 'Lane 3, under the shade cloth',
    reporter: { kind: 'volunteer', name: 'Kai Walker', quote: 'Teen fainted in lane 3, sitting up now, can first aid come', language: 'en' },
  }],
  P3: [{
    priority: 'P3', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'info-tent', handledBy: 'human',
    title: 'Blister plasters needed at Info Tent',
    summary: 'Two people at the Info Tent asking for blister plasters and sunscreen.',
    locationHint: null,
    reporter: { kind: 'staff', name: 'Noah Kim', quote: 'Couple of people here need blister plasters', language: 'en' },
  }],
};

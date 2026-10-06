import type { GuestRequest, Message, Priority, Proposal, Task, TaskEvent, Team, TeamSlug, Volunteer, Zone } from '@/lib/schema';
import { rankCandidates } from '@/lib/candidates';
import { clockTime } from '@/lib/format';
import { POLICY } from '@/lib/lifecycle';
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
  { slug: 'gate-a', name: 'Gate A (Tunnel)' },
  { slug: 'gate-b', name: 'Gate B (Walkway)' },
  { slug: 'lawn-stage', name: 'Oval Stage' },
  { slug: 'river-stage', name: 'Track Stage' },
  { slug: 'water-1', name: 'Water Station 1' },
  { slug: 'water-2', name: 'Water Station 2' },
  { slug: 'first-aid-hq', name: 'First Aid Post' },
  { slug: 'food-alley', name: 'Food Alley' },
  { slug: 'info-tent', name: 'Info Tent' },
  { slug: 'backstage', name: 'Backstage' },
  { slug: 'toilets-west', name: 'Toilets West' },
  { slug: 'toilets-east', name: 'Toilets East' },
  { slug: 'the-grove', name: 'The Grove' },
  { slug: 'pavilion', name: 'Pavilion (Crew HQ)' },
];

const vol = (
  id: string, name: string, teamSlug: TeamSlug | null, zoneSlug: string,
  extra: Partial<Volunteer> = {},
): Volunteer => ({
  id, name, teamSlug, zoneSlug, role: 'volunteer', skills: [], languages: ['en'], duty: 'on_duty', shiftEndsAt: null, phone: null, ...extra,
});

export const ME_ID = 'v-priya';
export const LEAD_ID = 'v-jordan';
export const MO_ID = 'v-mo';
/** The festival-goer on this device (dev panel "Festival-goer"). Not a volunteer. */
export const GUEST_ID = 'g-alex';

const shiftEndFor = (now: number) => now + 2 * 60 * MIN + 15 * MIN;

function volunteers(now: number): Volunteer[] {
  const shiftEnd = shiftEndFor(now);
  return [
    vol('v-mo', 'Mo', null, 'info-tent', { role: 'coordinator' }),
    vol('v-priya', 'Priya Shah', 'first-aid', 'lawn-stage', { skills: ['first-aid-cert', 'radio-trained'], languages: ['en', 'hi'], shiftEndsAt: shiftEnd }),
    vol('v-jordan', 'Jordan Lee', 'first-aid', 'first-aid-hq', { role: 'team_lead', skills: ['first-aid-cert'] }),
    vol('v-tom', 'Tom Becker', 'first-aid', 'river-stage', { skills: ['first-aid-cert'], shiftEndsAt: shiftEnd }),
    vol('v-ava', 'Ava Nguyen', 'first-aid', 'food-alley', { skills: ['first-aid-cert'], languages: ['en', 'vi'], shiftEndsAt: shiftEnd }),
    vol('v-ben', 'Ben Carter', 'first-aid', 'water-1', { skills: ['first-aid-cert', 'radio-trained'], shiftEndsAt: shiftEnd }),
    vol('v-maya', 'Maya Singh', 'first-aid', 'gate-a', { skills: ['first-aid-cert'], languages: ['en', 'hi'], shiftEndsAt: shiftEnd }),
    vol('v-linh', 'Linh Tran', 'welfare', 'food-alley', { skills: ['wwcc', 'multilingual'], languages: ['en', 'vi'] }),
    vol('v-sofia', 'Sofia Russo', 'welfare', 'info-tent', { role: 'team_lead', skills: ['wwcc'] }),
    vol('v-kai', 'Kai Walker', 'crowd', 'gate-a', { skills: ['crowd-control', 'radio-trained'] }),
    vol('v-amara', 'Amara Okafor', 'crowd', 'gate-b', { role: 'team_lead', skills: ['crowd-control'] }),
    vol('v-dev', 'Dev Patel', 'security', 'river-stage'),
    vol('v-noah', 'Noah Kim', 'info', 'info-tent', { languages: ['en', 'ko'] }),
    vol('v-elena', 'Elena García', 'artist', 'backstage', { languages: ['en', 'es'] }),
    vol('v-sam', 'Sam O’Brien', 'vendors', 'food-alley', { skills: ['rsa'] }),
    vol('v-rui', 'Rui Chen', 'ops', 'lawn-stage', { skills: ['radio-trained'], duty: 'on_break' }),
  ].map((v, i) => ({ ...v, phone: `+61 400 555 ${101 + i}` })); // mock numbers only
}

const task = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'summary' | 'priority' | 'createdAt'>): Task => ({
  category: 'other', teamSlug: null, zoneSlug: null, locationHint: null, status: 'open', assigneeId: null,
  reporter: { kind: 'festivalgoer', quote: t.summary, language: 'en' }, handledBy: 'human',
  assignedAt: null, etaAt: null, lastActivityAt: t.createdAt, nudgeCount: 0, lastNudgeAt: null,
  leadAlertedAt: null, resolvedAt: null, escalation: null, helperIds: [], requestId: null,
  resolution: t.status === 'resolved' ? 'done' : null, ...t,
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
      title: 'Restock first aid bag at Oval Stage',
      summary: 'Bag at the Oval Stage side tent is low on gauze, saline and ice packs.',
      locationHint: 'Side tent, stage left',
      reporter: { kind: 'volunteer', name: 'Tom Becker', quote: 'Oval stage kit is nearly out of gauze and ice packs', language: 'en' },
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
    // Jordan's Needs you on load: one of each kind (asked for help, went quiet, approval, unassigned).
    task({
      id: 't-faint', priority: 'P2', category: 'heat', teamSlug: 'first-aid', zoneSlug: 'river-stage',
      title: 'Teen fainted at Track Stage barrier', summary: 'Girl, about 16, fainted at the front barrier. Came round, pale and shaky.',
      locationHint: 'Front barrier, stage right',
      status: 'escalated', assigneeId: 'v-tom', createdAt: now - 7 * MIN, assignedAt: now - 6 * MIN, etaAt: now + 4 * MIN, lastActivityAt: now - 40_000,
      escalation: { at: now - 40_000, reason: 'She fainted again. I need a second pair of hands.', level: 'lead', ownerId: LEAD_ID, bumpedAt: null, response: null },
    }),
    task({
      id: 't-cut', priority: 'P3', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'food-alley',
      title: 'Cut hand at stall 9', summary: 'Stallholder cut their hand on a tin lid. Bleeding is light.',
      status: 'accepted', assigneeId: 'v-ava', createdAt: now - 29 * MIN, assignedAt: now - 28 * MIN, etaAt: now - 7 * MIN, lastActivityAt: now - 27 * MIN,
      nudgeCount: 1, lastNudgeAt: now - 6 * MIN, leadAlertedAt: now - 2 * MIN,
    }),
    task({
      id: 't-asthma', priority: 'P2', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'lawn-stage',
      title: 'Asthma attack at Oval Stage', summary: 'Young man wheezing, has his inhaler but it is not helping much. Friend is with him.',
      locationHint: 'Middle of the oval, by the sound desk',
      reporter: { kind: 'festivalgoer', quote: 'my mate is having an asthma attack at the back of the oval stage', language: 'en' },
      handledBy: 'ai', status: 'open', createdAt: now - 10_000,
    }),
    task({
      id: 't-ice', priority: 'P3', category: 'facilities', teamSlug: 'first-aid', zoneSlug: 'gate-a',
      title: 'Ice packs for Gate A', summary: 'Gate volunteers want a box of ice packs for the queue lanes.',
      reporter: { kind: 'volunteer', name: 'Kai Walker', quote: 'Can someone drop ice packs at Gate A', language: 'en' },
      status: 'open', createdAt: now - 3 * MIN,
    }),
    // The festival-goer's report, approved by Jordan; Ben is on the way.
    task({
      id: 't-mum', priority: 'P2', category: 'heat', teamSlug: 'first-aid', zoneSlug: 'gate-b',
      title: 'Woman feeling faint at Gate B', summary: 'Woman in her 50s feeling faint and hot. Sitting in the shade with her son.',
      locationHint: 'Shade cloth by the ticket booth', requestId: 'r-mum',
      reporter: { kind: 'festivalgoer', name: 'Alex', quote: 'my mum feels really faint, we’re in the shade at gate b', language: 'en' },
      handledBy: 'ai', status: 'accepted', assigneeId: 'v-ben', createdAt: now - 3 * MIN, assignedAt: now - 2 * MIN, etaAt: now + 8 * MIN, lastActivityAt: now - 2 * MIN,
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
    ev('e15', 't-faint', now - 7 * MIN, 'created', 'Reported by a festival-goer', triage),
    ev('e16', 't-faint', now - 6 * MIN, 'assigned', 'Assigned to Tom', triage),
    { ...ev('e17', 't-faint', now - 40_000, 'escalated', 'Needs help, escalated to team lead', { kind: 'human', id: 'v-tom', name: 'Tom Becker' }), reply: 'need_help', note: 'She fainted again. I need a second pair of hands.' },
    ev('e18', 't-cut', now - 29 * MIN, 'created', 'Reported by stallholder', triage),
    ev('e19', 't-cut', now - 28 * MIN, 'assigned', 'Assigned to Ava', triage),
    ev('e20', 't-cut', now - 6 * MIN, 'nudged', 'Still on "Cut hand at stall 9"? Send a quick update.', { kind: 'system', name: 'Scheduler' }),
    ev('e21', 't-cut', now - 2 * MIN, 'lead_alerted', 'No update on "Cut hand at stall 9". Lead alerted.', { kind: 'system', name: 'Scheduler' }),
    ev('e22', 't-asthma', now - 10_000, 'created', 'Reported by a festival-goer', triage),
    ev('e23', 't-asthma', now - 10_000, 'proposed', 'Suggested a volunteer, waiting for approval', { kind: 'agent', name: 'Assign' }),
    ev('e24', 't-ice', now - 3 * MIN, 'created', 'Reported by Kai Walker', triage),
    ev('e25', 't-mum', now - 3 * MIN, 'created', 'Reported by a festival-goer', triage),
    ev('e26', 't-mum', now - 2 * MIN, 'assigned', 'Approved by Jordan Lee, assigned to Ben', { kind: 'human', id: LEAD_ID, name: 'Jordan Lee' }),
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
      body: 'When you get a sec, grab a fresh bag from the First Aid Post. Oval kit is running low.',
    },
    {
      id: 'm3', recipientId: ME_ID, at: now - 34 * MIN, kind: 'broadcast', fromName: 'Mo', read: true,
      body: 'Heat plan is ON. 34°C and climbing. Water stations fully staffed, rotate every 45 min, drink something now.',
    },
    {
      id: 'm4', recipientId: ME_ID, at: now - 80 * MIN, kind: 'system', fromName: 'Moloop', read: true,
      body: `You’re checked in for First Aid & Heat until ${clockTime(shiftEndFor(now))}. Reply “copy”, “on my way”, “done” or “need help” by voice or tap.`,
    },
    {
      id: 'm5', recipientId: LEAD_ID, at: now - 40_000, kind: 'escalation', fromName: 'Moloop', taskId: 't-faint', read: false,
      body: 'Tom asked for help: Teen fainted at Track Stage barrier.',
    },
    {
      id: 'm6', recipientId: LEAD_ID, at: now - 2 * MIN, kind: 'escalation', fromName: 'Moloop', taskId: 't-cut', read: false,
      body: 'Ava went quiet: Cut hand at stall 9.',
    },
    {
      id: 'm7', recipientId: LEAD_ID, at: now - 10_000, kind: 'escalation', fromName: 'Moloop', taskId: 't-asthma', read: false,
      body: 'Approve: Asthma attack at Oval Stage.',
    },
  ];
}

function requests(now: number): GuestRequest[] {
  return [
    {
      id: 'r-toilet', createdAt: now - 18 * MIN, heard: 'Where are the closest toilets to the Oval Stage?', zoneSlug: 'lawn-stage', locationHint: null,
      stage: 'answered', aiAnswer: GUEST_ANSWERS[0].answer, taskId: null, reopenedAt: null,
      thread: [
        { from: 'guest', text: 'Where are the closest toilets to the Oval Stage?', at: now - 18 * MIN },
        { from: 'ai', text: GUEST_ANSWERS[0].answer, at: now - 18 * MIN + 2_000 },
      ],
    },
    {
      id: 'r-mum', createdAt: now - 3 * MIN, heard: 'My mum feels really faint, we’re in the shade at Gate B', zoneSlug: 'gate-b', locationHint: 'Shade cloth by the ticket booth',
      stage: 'finding', aiAnswer: null, taskId: 't-mum', reopenedAt: null,
      thread: [{ from: 'guest', text: 'My mum feels really faint, we’re in the shade at Gate B', at: now - 3 * MIN }],
    },
  ];
}

function proposals(now: number, vols: Volunteer[], ts: Task[]): Proposal[] {
  const asthma = ts.find((t) => t.id === 't-asthma')!;
  return [
    {
      // Full countdown from load, so the Approve sheet has something to show.
      id: 'p-asthma', taskId: 't-asthma', candidates: rankCandidates(asthma, vols, ts), createdAt: now,
      autoAssignAt: now + POLICY.autoAssignMs, status: 'pending', volunteerId: null, decidedById: null, decidedAt: null,
    },
    {
      id: 'p-mum', taskId: 't-mum', candidates: [{ volunteerId: 'v-ben', rationale: 'free · 280 m · first aid cert', distanceM: 280 }],
      createdAt: now - 3 * MIN, autoAssignAt: now - 3 * MIN + POLICY.autoAssignMs, status: 'approved',
      volunteerId: 'v-ben', decidedById: LEAD_ID, decidedAt: now - 2 * MIN,
    },
  ];
}

export function initialSnapshot(now: number): Snapshot {
  const byKey = <T, K extends keyof T>(xs: T[], k: K) => Object.fromEntries(xs.map((x) => [x[k] as string, x]));
  const vols = volunteers(now);
  const ts = tasks(now);
  return {
    status: 'ready',
    now,
    meId: ME_ID,
    guestId: GUEST_ID,
    teams: byKey(TEAMS, 'slug'),
    zones: byKey(ZONES, 'slug'),
    volunteers: byKey(vols, 'id'),
    tasks: byKey(ts, 'id'),
    events: events(now),
    messages: messages(now),
    requests: byKey(requests(now), 'id'),
    proposals: byKey(proposals(now, vols, ts), 'id'),
  };
}

/** Task fields a canned report supplies; the repo fills in ids, times and lifecycle fields. */
export type TaskDraft = Omit<
  Task,
  | 'id' | 'createdAt' | 'lastActivityAt' | 'status' | 'assigneeId' | 'assignedAt' | 'etaAt' | 'nudgeCount' | 'lastNudgeAt'
  | 'leadAlertedAt' | 'resolvedAt' | 'escalation' | 'helperIds' | 'resolution' | 'requestId'
>;

/** Stand-in for the AI's routine answers (answer_info). First matching pattern wins. */
export const GUEST_ANSWERS: { re: RegExp; answer: string }[] = [
  { re: /toilet|bathroom|loo|restroom/i, answer: 'Nearest toilets to the Oval Stage are Toilets East, by the tennis courts. There are more at Toilets West, next to the Grove.' },
  { re: /water|refill|drink/i, answer: 'Free water refills at Water Station 1 (west end of Food Alley) and Water Station 2 (east end, near the Oval Stage).' },
  { re: /lost property|lost my|left my/i, answer: 'Lost property is at the Info Tent, open until 11pm. Bring ID to collect.' },
  { re: /\b(times?|set|on next|playing|line-?up|schedule)\b/i, answer: 'Next up: Oval Stage at 5:30pm, Track Stage at 6:00pm. Full times are on the board at the Info Tent.' },
  { re: /\b(map|where is|where's|how do i get)\b/i, answer: 'The Info Tent is just inside Gate B, on the left. Food Alley runs between the oval and the track.' },
];

/** Canned festival-goer lines for the dev panel scenarios. */
export const GUEST_SCRIPTS = {
  question: { text: 'What time is the next set on the Oval Stage?', zoneSlug: 'lawn-stage' },
  report: { text: 'Can someone bring blister plasters and sunscreen? We’re at the Info Tent', zoneSlug: 'info-tent' },
  p1: { text: 'My friend collapsed and isn’t responding, front left of the Track Stage', zoneSlug: 'river-stage' },
} as const;

/** Canned reports for "simulate incoming task" in the dev panel. */
export const INCOMING: Record<Priority, TaskDraft[]> = {
  P1: [{
    priority: 'P1', category: 'medical', teamSlug: 'first-aid', zoneSlug: 'river-stage', handledBy: 'human',
    title: 'Woman collapsed, Track Stage front-left',
    summary: 'Woman in her 20s collapsed in the crowd, not responding to her friends. Friends are with her.',
    locationHint: 'Front-left of the barrier, near the speaker stack',
    reporter: { kind: 'festivalgoer', quote: 'my friend just collapsed and she’s not answering us, front left of pond stage', language: 'en' },
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

import { z } from 'zod';

import { IncidentCategory, TEAM_SLUGS } from '@/lib/schema';
import type { Tool } from '.';
import { venueFacts, type Zone } from './venue';

/**
 * The intake agent's tools. It reads one message from a festival-goer or a volunteer and calls one of them:
 *
 *  - `create_task`: a volunteer can handle it; the allocator (dispatch) picks who.
 *  - `escalate`: a lead or Mo decides before anyone is sent; the allocator stays out of it.
 *  - `answer_question` (festival-goers only): a routine question answered from the venue facts. Not routing: nobody
 *    is sent, and the server only keeps the answer if the classifier agrees it's routine.
 *
 * Calling a tool only returns its arguments: the server checks them (interpreter.ts) and the commands carry them out
 * inside the world lock (createGuestTask, fileReport, escalateNew in src/lib/commands.ts).
 */

/** Which team acts on it. Shared with the `decide` cross-check, which reads the same wording. */
export const TEAMS = {
  'first-aid': 'Someone is hurt, ill, collapsed, bleeding, faint, overheated, drugged, or having an allergic or asthma attack. Any medical need beats every other team',
  welfare: 'A lost or separated child or adult, someone vulnerable, distressed, harassed, followed or feeling unsafe, or lost property',
  crowd: 'Too many people in one place, pushing or surging, long or blocked queues, gates, barriers, exits, evacuation routes',
  security: 'A fight, theft, weapon, threat, trespass or forced entry, or an aggressive or very drunk person who is not hurt',
  info: 'Questions and the audience desk: directions, times, accessibility, tickets, refunds, and festival-goers\' complaints or feedback. If something needs doing on site, the team that does it',
  artist: 'Performers, bands, their crew or guests; backstage, green room, stage management, set times, riders',
  vendors: 'Food and drink stalls and their staff: gas, cooking, stock, payments, stallholder complaints',
  ops: 'Facilities and infrastructure: power, lighting, sound or PA, spills, bins, toilets, water, cables, fencing, weather damage',
} satisfies Record<(typeof TEAM_SLUGS)[number], string>;

const Incident = {
  title: z.string().describe('English, at most 60 characters. What and where, e.g. "Collapsed person at Food Alley"'),
  summary: z.string().describe('English, at most two short sentences. Facts from the message only.'),
  team: z.enum(TEAM_SLUGS).describe('The team that will act on it'),
  priority: z.enum(['P1', 'P2', 'P3']).describe('P1 life-threatening or many people at risk; P2 someone needs help within minutes; P3 routine'),
  category: IncidentCategory,
  zone: z.string().nullable().describe('Slug of the place named in the message, from the list, else null'),
  place: z.string().nullable().describe('The location as the person described it, else null'),
  language: z.string().describe('ISO 639-1 code of the language the message is written in, e.g. "en", "es"'),
};

export const CreateTaskArgs = z.object(Incident);
export const EscalateArgs = z.object({
  ...Incident,
  level: z.enum(['lead', 'coordinator']).describe('"coordinator" (Mo) only for decisions about the whole event or outside services; otherwise "lead"'),
  reason: z.string().describe('One short sentence the lead or Mo can act on: what needs deciding. At most 140 characters.'),
});

export const createTask: Tool<typeof CreateTaskArgs> = {
  name: 'create_task',
  description:
    'A trained volunteer can handle this on their own once they get there: help, check, clean, fix, guide or report back. '
    + 'Includes urgent first aid and welfare that a volunteer responds to. The allocator picks who goes.',
  args: CreateTaskArgs,
};

export const escalate: Tool<typeof EscalateArgs> = {
  name: 'escalate',
  description:
    'Someone with authority must decide before anyone is sent. '
    + 'lead: removing or refusing someone, a refund or complaint, changing an artist\'s or vendor\'s arrangements, police, media or money, '
    + 'several volunteers or a skill nobody may have, or anything unclear. '
    + 'coordinator (Mo): evacuating or closing an area, holding or stopping a performance, calling an ambulance, police or fire to the site, '
    + 'cutting power to a stage, moving a whole team, a public announcement, or a threat to many people.',
  args: EscalateArgs,
};

export const AnswerArgs = z.object({
  answer: z.string().describe('1-2 short sentences from the venue facts, in the same language as the message'),
  language: z.string().describe('ISO 639-1 code of the language the message is written in, e.g. "en", "es"'),
});

export const answerQuestion: Tool<typeof AnswerArgs> = {
  name: 'answer_question',
  description: 'The message is only a routine question (toilets, water, times, lost-property process, directions) that the venue facts answer. Nobody is sent.',
  args: AnswerArgs,
};

/** The tools for one message. A festival-goer's may also be a routine question to answer. */
export const intakeTools = (canAnswer: boolean): Tool[] => (canAnswer ? [answerQuestion, createTask, escalate] : [createTask, escalate]);

/** `canAnswer`: a festival-goer's message, which may be a routine question answered without a tool. */
export const INTAKE_SYSTEM = (zs: Zone[], canAnswer: boolean) => `You are the intake desk for a 15,000-person music festival. Every message is from a festival-goer or a staff member. Decide what happens to it.
${canAnswer ? `
First: if the message is only a routine question (toilets, water, times, lost-property process, directions) and the venue facts below answer it, call answer_question. A volunteer walking over to answer a question wastes them. Answer in 1-2 short sentences in the SAME language as the message, even when the facts are in English. Never answer anything involving injury, illness, children, safety, security, crowding, weather or distress, and never promise an action, a time or a person. If the facts don't cover it, use create_task or escalate. If you already answered and they say it didn't solve it, don't repeat yourself: answer again only if the facts say something new, otherwise create_task. If their latest message is about something new, decide on that.

Venue facts:
${venueFacts(zs)}
` : ''}
Otherwise call exactly one of these:
- create_task when someone should go there: to help, check, calm things down, clean, fix, guide or report back. This holds however urgent it is and even if a lead would want to know, because leads see every task and can step in: a collapsed person is create_task at P1, and so is a fight starting.
- escalate only when a decision has to be made before anyone moves, or the message asks for something a volunteer may not do or promise. Use level "coordinator" only for decisions that affect the whole event or need outside services; otherwise "lead". Give the reason in one short sentence a lead can act on.
- A question about what to do is not a decision: answer it, or create_task for the info team.
- If you are unsure, and someone may need help now, create_task. Otherwise escalate to lead.
- Each message says who sent it and where from. A volunteer is usually standing where it is happening. A team lead or Mo telling their own people what to do is create_task: they have already decided. Escalate only to someone above the sender: a team lead escalates only to Mo, and Mo never escalates.

Teams (pick the one that will act):
${Object.entries(TEAMS).map(([slug, d]) => `${slug}: ${d}`).join('\n')}

Priority: P1 life-threatening or many people at risk; P2 someone needs help within minutes; P3 routine. If unsure between two, pick the more urgent.

Write title and summary in English whatever language the message is in. Never invent facts.

Places (slug: name):
${zs.map((z) => `${z.slug}: ${z.name}`).join('\n')}`;

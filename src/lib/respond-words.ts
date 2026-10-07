import type { EscalationResponseKind, HandoverTarget } from '@/lib/schema';

/**
 * What a lead said on the Respond screen, read as one of the responses on it. The server's interpreter asks a model
 * first (src/server/models/interpreter.ts); these keywords stand in when it fails or isn't sure.
 */
export type RespondCommand =
  | { kind: 'backup' | 'reassign'; volunteerId?: string }
  | { kind: 'handover'; target: HandoverTarget }
  | { kind: 'call' } | { kind: 'carry_on' } | { kind: 'pass' }
  | { kind: 'close'; note?: string };

/** Someone who could be sent: not the volunteer on the task, nor anyone already helping. */
export type Named = { id: string; name: string };

const EMERGENCY = /\b(000|triple zero|ambulance|paramedics?|emergency|police|fire brigade)\b/;
const MEDICS = /\b(medics?|medical|first aid|nurse|doctor)\b/;
const SECURITY = /\b(security|guards?)\b/;
const HAND = /\b(hand(ing)? (it |this |them |her |him )?(over|off|to)|pass (it |this )?to|get|bring in)\b/;
const PASS = /\b(pass|send|give|escalate|bump)\b.*\bmo\b/;
const REASSIGN = /\b(reassign|swap|instead|take over|give (it|this) to|move (it|this) to)\b/;
const BACKUP = /\b(backup|back up|back her up|back him up|help (her|him|them)|send|join|go help|go with)\b/;
const CALL = /\b(call|ring|phone)\b/;
const CARRY_ON = /\b(carry on|keep going|they('| a)?re (fine|ok|okay|good)|(she|he)('s| is) (fine|ok|okay|good)|all good|leave it)\b/;
const CLOSE = /\b(close|cancel|not needed|false alarm|never ?mind|stand down)\b/;

const clean = (said: string) => said.toLowerCase().replace(/[’']/g, "'");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Says 000, an ambulance, the police: only ever opens the 000 step, whatever else is read. */
export const soundsEmergency = (said: string) => EMERGENCY.test(clean(said));

/** A volunteer named in what was said, by first name (or full name). */
export function namedIn(said: string, people: Named[]): string | undefined {
  const text = clean(said);
  const hit = people
    .map((v) => ({ v, full: v.name.toLowerCase(), first: v.name.split(' ')[0].toLowerCase() }))
    .find(({ full, first }) => new RegExp(`\\b(${escape(full)}|${escape(first)})\\b`).test(text));
  return hit?.v.id;
}

/**
 * `available`: the responses that fit right now. `canPass`: "Pass to Mo" fits. `people`: who could be sent.
 * Returns null when it isn't one of them.
 */
export function readRespondWords(
  said: string,
  { available, canPass, people }: { available: EscalationResponseKind[]; canPass: boolean; people: Named[] },
): RespondCommand | null {
  const text = clean(said);
  const can = (k: EscalationResponseKind) => available.includes(k);
  const who = namedIn(text, people);

  if (canPass && PASS.test(text)) return { kind: 'pass' };
  if (can('handover')) {
    if (EMERGENCY.test(text)) return { kind: 'handover', target: 'emergency' };
    if (MEDICS.test(text) && (HAND.test(text) || !who)) return { kind: 'handover', target: 'medics' };
    if (SECURITY.test(text)) return { kind: 'handover', target: 'security' };
  }
  if (can('reassign') && REASSIGN.test(text)) return { kind: 'reassign', volunteerId: who };
  if (can('backup') && BACKUP.test(text)) return { kind: 'backup', volunteerId: who };
  if (can('carry_on') && CARRY_ON.test(text)) return { kind: 'carry_on' };
  if (can('call') && CALL.test(text) && !who) return { kind: 'call' };
  if (can('close') && CLOSE.test(text)) return { kind: 'close', note: said.trim() };
  // Just a name: send them. "Went quiet" has no backup, so there it means give it to them.
  if (who) return can('backup') ? { kind: 'backup', volunteerId: who } : can('reassign') ? { kind: 'reassign', volunteerId: who } : null;
  return null;
}

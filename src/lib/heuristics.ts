import type { DetailRead, EscalateTo, Triage, Understood } from '@/lib/ai';
import type { IncidentCategory, Priority, ReplyKind, TeamSlug } from '@/lib/schema';

/**
 * Keyword stand-ins for the models: the reply classifier, triage and the routine-answer agent.
 * What the server falls back on when a model is down or live models are off.
 */

// Order matters: "need help" before "help"-ish report words.
const REPLY_PATTERNS: [ReplyKind, RegExp][] = [
  ['need_help', /\b(need (some )?help|need backup|send (help|backup)|can'?t handle)\b/i],
  ['done', /\b(done|all good|sorted|finished|resolved|all clear)\b/i],
  ['still_on_it', /\b(still on it|running late|delayed|few more min(ute)?s|held up)\b/i],
  ['decline', /\b(can'?t take|decline|not me)\b/i],
  ['accept', /\b(accept|copy|got it|roger|on it|will do|on my way|omw|heading (there|over))\b/i],
];

// Keyword → team. First match wins.
const TRIAGE: { team: TeamSlug; re: RegExp }[] = [
  { team: 'first-aid', re: /(collapsed|faint|bleed|injur|hurt|dizzy|heat|unconscious|sting|vomit|asthma|breath|blister|plaster|sunscreen|allerg|anaphyla|epi-?pen|swelling|swollen|throat)/i },
  { team: 'welfare', re: /(lost (child|kid)|can'?t find (my|their)|crying|harass|unsafe|lost property)/i },
  { team: 'crowd', re: /(queue|crowd|crush|gate|barrier|packed)/i },
  { team: 'security', re: /(fight|theft|stole|weapon|aggressive|drunk)/i },
  { team: 'artist', re: /(artist|green room|backstage|rider|band)/i },
  { team: 'vendors', re: /(vendor|stall|food|gas|bbq)/i },
  { team: 'ops', re: /(spill|bin|power|light|toilet|cable|water station|leak)/i },
];
// Swelling lips, tongue or throat: a possible anaphylaxis, which the models read as P2 about one run in three.
const P1 = /(unconscious|unresponsive|not breathing|not moving|isn'?t moving|not responding|isn'?t responding|collapsed|lost (child|kid)|weapon|crush|anaphyla|epi-?pen|(lips?|tongue|throat|face) (is |are )?(swelling|swollen|closing)|swelling (up )?(lips?|tongue|throat)|throat (is )?closing)/i;
/** First aid that can wait: P3 rather than P2. */
const MINOR = /(blister|plaster|sunscreen|band-?aid|graze|ice pack)/i;
/** Does added detail sound worse? */
const WORSE = /(worse|not breathing|can'?t breathe|unconscious|not responding|collapsed|bleeding|seizure|passed out|chest pain|vomit)/i;
/** A bare plea ("help", "please help!!"): nothing to read but that someone may be in trouble. */
const PLEA = /^\s*(please\s+)?(help|help me|sos)(\s+please)?[\s!.]*$/i;
// A need they can walk to ("I need water") reads like a question: the answer is where to go.
const QUESTION = /^(where|what|when|how|is|are|can i|do|does|which|(i|we) (really )?need)\b|\?\s*$/i;

export const TEAM_CATEGORY: Record<TeamSlug, IncidentCategory> = {
  'first-aid': 'medical', welfare: 'other', crowd: 'crowding', security: 'security',
  info: 'info_request', artist: 'artist', vendors: 'vendor', ops: 'facilities',
};

/** Stand-in for the AI's routine answers (answer_info). First matching pattern wins. */
export const GUEST_ANSWERS: { re: RegExp; answer: string }[] = [
  { re: /toilet|bathroom|loo|restroom/i, answer: 'Nearest toilets to the Oval Stage are Toilets East, by the tennis courts. There are more at Toilets West, next to the Grove.' },
  { re: /water|refill|drink/i, answer: 'Free water refills at Water 1 (in the Grove, by the first aid tent) and Water 2 (east end, near the Oval Stage).' },
  { re: /lost property|lost my|left my/i, answer: 'Lost property is at Info, the tent just inside the Main Entrance, open until 11pm. Bring ID to collect.' },
  { re: /\b(times?|set|on next|playing|line-?up|schedule)\b/i, answer: 'Next up: Oval Stage at 5:30pm, Track Stage at 6:00pm. Full times are on the board at Info.' },
  { re: /\b(map|where is|where's|how do i get)\b/i, answer: 'Info is the tent just inside the Main Entrance, on the left. Food Alley runs between the oval and the track.' },
  // General advice, so "what do I do if my friend feels faint later?" gets an answer rather than a lead's decision.
  // Keywords never give it: routineAnswer holds back anything that sounds medical, so only the AI quotes it.
  {
    re: /\bfeel(s|ing)? (faint|dizzy|unwell|sick)\b/i,
    answer: 'If someone feels faint or unwell: sit them down in the shade, give them water, and ask any volunteer in a hi-vis vest, or go to First Aid on the south walk. If they collapse or stop responding, report it straight away.',
  },
];

/** Stand-in for triage: keyword → team + priority. */
export function triage(text: string): { team: TeamSlug; priority: Priority } {
  const team = TRIAGE.find((x) => x.re.test(text))?.team ?? 'ops';
  const priority: Priority = P1.test(text) ? 'P1'
    : team === 'first-aid' && MINOR.test(text) ? 'P3'
      : team === 'first-aid' || team === 'security' || team === 'welfare' ? 'P2' : 'P3';
  return { team, priority };
}

/** The team for "talk to a person": whatever fits, Info if nothing does. */
export const teamForPerson = (text: string): TeamSlug => TRIAGE.find((x) => x.re.test(text))?.team ?? 'info';

/** A routine question the AI can answer itself, or null if someone needs to come. */
export function routineAnswer(text: string): string | null {
  if (!QUESTION.test(text.trim()) || P1.test(text) || WORSE.test(text)) return null;
  if (TRIAGE.some((x) => (x.team === 'first-aid' || x.team === 'security') && x.re.test(text))) return null;
  return GUEST_ANSWERS.find((a) => a.re.test(text))?.answer ?? null;
}

/** Does a festival-goer's added detail mean it got worse? */
export const soundsWorse = (text: string) => WORSE.test(text);

/**
 * Is a short utterance a reply to the task you're on? A helper can only finish; escalating is the owner's call.
 * Long utterances are reports even if they contain "done" etc. Replies are short.
 */
export function replyIn(heard: string, helping: boolean): ReplyKind | null {
  const match = REPLY_PATTERNS.find(([kind, re]) => re.test(heard) && !(helping && kind !== 'done'));
  return match && heard.split(/\s+/).length <= 8 ? match[0] : null;
}

/** Keep the reason, drop the trigger phrase: "need help, he's getting worse" → "he's getting worse". */
export function noteFor(reply: ReplyKind, heard: string): string | undefined {
  if (reply !== 'need_help') return heard;
  return heard.replace(REPLY_PATTERNS[0][1], '').replace(/^[\s,.;:-]+/, '').trim() || undefined;
}

// ── the same decisions, in the shape the models give them ──

const titleFrom = (text: string) => {
  const t = text.length > 55 ? `${text.slice(0, 52).trim()}…` : text;
  return t[0].toUpperCase() + t.slice(1);
};

/** Is there a reason to doubt a routine reading of this text? A hard stop on AI answers and a floor on priority. */
export const soundsUrgent = (text: string) => P1.test(text) || WORSE.test(text) || PLEA.test(text);
/** Words that mean someone's life may be at risk: priority P1 whatever a model says. */
export const soundsCritical = (text: string) => P1.test(text);

// Requests a volunteer mustn't act on alone. Mo: the whole event or outside services. Lead: a judgement call.
const MO_ONLY = /\b(evacuat\w*|stop (the )?(show|set|music|gig)|(stage|show) hold|hold the (stage|show|set)|ambulance|police|cops|fire brigade|on fire|a fire|triple zero|000|bomb|suspicious (package|bag|item)|unattended (bag|backpack|package|item)|gas leak|announcement|close (the )?(gates?|oval|stage|area|entrance)\w*)\b/i;
const LEAD = /\b(refund\w*|complain\w*|compensation|press|journalist|media|kick(ed)? (\w+ )?out|eject\w*|ban(ned)?|set times?|swap (their |the )?sets?|manager)\b/i;

/** Who must decide before a volunteer is sent, by keywords. Null: a volunteer can handle it. A floor under the AI's call. */
export function authorityFor(text: string): EscalateTo | null {
  const mo = MO_ONLY.exec(text);
  if (mo) return { level: 'coordinator', reason: `Mentions “${mo[0]}”: needs Mo's call` };
  const lead = LEAD.exec(text);
  return lead ? { level: 'lead', reason: `Mentions “${lead[0]}”: needs a lead's call` } : null;
}

/** Keyword triage as a full Triage: what the server falls back on when a model is down. */
/**
 * Keywords can't tell a language, so a report read without the AI says "und" (ISO 639 for undetermined), not English,
 * and carries no translation: screens show it as written, marked as not translated.
 */
export const UNKNOWN_LANGUAGE = 'und';

export function heuristicTriage(text: string, zoneSlug: string | null = null, locationHint: string | null = null): Triage {
  const { team, priority } = triage(text);
  const category = team === 'welfare' && /child|kid|son|daughter/i.test(text) ? 'lost_child' : TEAM_CATEGORY[team];
  return { team, priority, category, title: titleFrom(text), summary: text, zoneSlug, locationHint, language: UNKNOWN_LANGUAGE, escalate: authorityFor(text) };
}

export function heuristicUnderstanding(text: string, zoneSlug: string | null = null, locationHint: string | null = null): Understood {
  const answer = routineAnswer(text);
  return answer ? { kind: 'answer', answer, language: 'en' } : { kind: 'task', ...heuristicTriage(text, zoneSlug, locationHint) };
}

/** "Talk to a person" on an AI answer: a P3 task for the team that fits (Info if nothing does). */
export function heuristicPerson(text: string, zoneSlug: string | null = null, locationHint: string | null = null): Triage {
  const team = teamForPerson(text);
  return { ...heuristicTriage(text, zoneSlug, locationHint), team, category: TEAM_CATEGORY[team], priority: 'P3' };
}

export const heuristicDetail = (text: string): DetailRead => ({ worse: soundsWorse(text) });

import { PriorityResult, RewriteResult, TEAM_SLUGS, type ReportInput, type RouteResult, type TeamResult } from '@/lib/schema';
import { classifier, llm } from '../models';

const TEAM_LABELS = [
  { id: 'first-aid', description: 'medical injury illness collapsed bleeding seizure unconscious breathing heat dehydration faint dizzy' },
  { id: 'welfare', description: 'lost child separated vulnerable harassed unsafe lost property' },
  { id: 'crowd', description: 'crowding crush queue gate barrier storm evacuation overcrowded' },
  { id: 'security', description: 'fight theft weapon trespass drunk aggressive security' },
  { id: 'info', description: 'wheelchair accessibility directions information schedule audience question' },
  { id: 'artist', description: 'artist performer band backstage green room rider stage manager' },
  { id: 'vendors', description: 'vendor stall food drink gas cooking stallholder payment' },
  { id: 'ops', description: 'technical power lighting sound spill bins toilets water station cables logistics' },
] as const satisfies readonly { id: (typeof TEAM_SLUGS)[number]; description: string }[];

const PRIORITY_LABELS = [
  { id: 'P1', description: 'life threatening unconscious not breathing missing child weapon crush severe bleeding' },
  { id: 'P2', description: 'urgent injury heat illness fight distress needs help within minutes' },
  { id: 'P3', description: 'routine non urgent question inconvenience facilities' },
] as const;

const REWRITE_SYSTEM = `Rewrite a raw festival report for a safety lead reading on a phone while walking.
title: <=60 chars, lead with what + where. summary: <=2 short sentences, English, no speculation.
Extract zone slug if identifiable, skills needed, people involved. Never invent facts.`;

/** Report Triage Agent: the three branches run in parallel, matching the flow diagram. */
export async function triage(input: ReportInput, route: RouteResult) {
  const text = route.textEn;
  const [team, priority, rewrite] = await Promise.all([
    classifier.classify({ text, labels: TEAM_LABELS }).then(
      (r): TeamResult => ({
        team: r.label,
        confidence: r.confidence,
        alternates: Object.entries(r.scores)
          .filter(([k]) => k !== r.label)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => ({ team: k as TeamResult['team'], confidence: v })),
      }),
    ),
    classifier.classify({ text, labels: PRIORITY_LABELS }).then((r) =>
      PriorityResult.parse({ priority: r.label, confidence: r.confidence }),
    ),
    llm.generate({
      system: REWRITE_SYSTEM,
      prompt: `Zone hint: ${input.zoneSlug ?? 'unknown'}\nLocation hint: ${input.locationHint ?? 'none'}\nReport (English): ${text}`,
      schema: RewriteResult,
    }),
  ]);
  return { team, priority, rewrite };
}

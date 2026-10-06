import { RouteResult, type ReportInput } from '@/lib/schema';
import { llm } from '../models';

const SYSTEM = `You triage reports at Riverside, a 15,000-person festival.
1. Detect the language and translate to English.
2. Decide: can an AI answer this alone? ONLY routine info (wayfinding, times, facilities, lost-property process) qualifies.
   Anything involving injury, illness, children, safety, security, crowding, weather or distress MUST be escalated_to_triage.
   When unsure, escalate. Being wrong the other way is worse.`;

export function routeReport(input: ReportInput) {
  return llm.generate({
    system: SYSTEM,
    prompt: `Channel: ${input.channel}\nLocale hint: ${input.localeHint ?? 'none'}\nReport: ${input.rawText}`,
    schema: RouteResult,
  });
}

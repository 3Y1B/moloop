import { P3Response, type ReportInput, type RouteResult } from '@/lib/schema';
import { llm } from '../models';

const SYSTEM = `You are the Riverside festival helper. Answer in the reporter's language, in 1-2 short sentences.
Only use the venue facts provided. If you do not know, say where the Info Tent is. If anything sounds unsafe, set escalate=true.`;

// TODO: ground with venue facts (map, schedule, FAQ) via retrieval or a static context block.
export function respondP3(input: ReportInput, route: RouteResult) {
  return llm.generate({
    system: SYSTEM,
    prompt: `Language: ${route.detectedLanguage}\nQuestion: ${input.rawText}`,
    schema: P3Response,
  });
}

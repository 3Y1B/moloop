import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LunaLlm } from './luna';

// The report pipeline's output shapes (main removed them with the old /api/reports pipeline); kept here to exercise
// enums, nullable fields and bounds against the live model.
const RouteResult = z.object({
  decision: z.enum(['ai_resolved', 'escalated_to_triage']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  detectedLanguage: z.string(),
  textEn: z.string(),
});
const RewriteResult = z.object({
  title: z.string().max(60),
  summary: z.string().max(280),
  category: z.enum(['medical', 'heat', 'lost_child', 'security', 'crowd', 'facilities', 'info_request', 'other']),
  zoneSlug: z.string().nullable(),
  locationHint: z.string().nullable(),
  requiredSkills: z.array(z.string()),
  peopleInvolved: z.number().int().nullable(),
});

// Opt-in: hits the real Spark gateway. Run with SPARK_API_KEY set, e.g.
//   SPARK_API_KEY=... npm test -- luna.live
describe.skipIf(!process.env.SPARK_API_KEY)('LunaLlm against the live Spark', () => {
  const llm = new LunaLlm();

  it("returns the pipeline's route decision, escalating a medical report", { timeout: 20_000 }, async () => {
    const route = await llm.generate({
      system: 'You triage festival reports. Anything involving injury, illness, children or safety MUST be escalated_to_triage.',
      prompt: 'Report: un hombre se desmayó cerca de los puestos de comida',
      schema: RouteResult,
    });

    expect(route.decision).toBe('escalated_to_triage');
    expect(route.detectedLanguage.toLowerCase()).toMatch(/^es|spanish/);
  });

  it("returns the pipeline's rewrite shape, with nullable fields and an enum", { timeout: 20_000 }, async () => {
    const rewrite = await llm.generate({
      system: 'Rewrite a raw festival report for a safety lead. title <= 60 chars, summary <= 2 sentences. Never invent facts.',
      prompt: 'Zone hint: food-alley\nReport (English): a guy collapsed by the food stalls, his mate is with him',
      schema: RewriteResult,
    });

    expect(rewrite.title.length).toBeGreaterThan(0);
    expect(rewrite.title.length).toBeLessThanOrEqual(60);
  });
});

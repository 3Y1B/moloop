import { describe, expect, it } from 'vitest';
import { RewriteResult, RouteResult } from '@/lib/schema';
import { LunaLlm } from './luna';

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

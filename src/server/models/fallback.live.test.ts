import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { withFallback } from './fallback';
import { LunaLlm } from './luna';
import { SpeechToText, TextToSpeech } from './speech-clients';

const RouteResult = z.object({ decision: z.enum(['ai_resolved', 'escalated_to_triage']), reason: z.string() });

// Opt-in: with the Spark unreachable, every model call should be answered by real OpenAI. Run with
//   OPENAI_API_KEY=... npm test -- fallback.live
describe.skipIf(!process.env.OPENAI_API_KEY)('fallback to OpenAI when the Spark is down', () => {
  const deadSpark = { baseUrl: 'https://spark.invalid/v1', apiKey: 'unused', retryDelayMs: 0 };
  const openai = { baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY };
  const limits = { primaryMs: 5_000, lastMs: 25_000 };

  it('chat: gpt-6-luna escalates a medical report', { timeout: 40_000 }, async () => {
    const spark = new LunaLlm(deadSpark);
    const luna = new LunaLlm({ ...openai, model: 'gpt-6-luna' });
    const ask = {
      system: 'You triage festival reports. Anything involving injury, illness, children or safety MUST be escalated_to_triage.',
      prompt: 'Report: a guy collapsed by the food stalls',
      schema: RouteResult,
    };

    const route = await withFallback(
      { id: spark.id, call: (signal) => spark.generate({ ...ask, signal }) },
      { id: luna.id, call: (signal) => luna.generate({ ...ask, signal }) },
      limits,
    );

    expect(route.decision).toBe('escalated_to_triage');
  });

  it('speech: gpt-4o-mini-tts speaks a brief that gpt-4o-mini-transcribe hears back', { timeout: 60_000 }, async () => {
    const tts = new TextToSpeech({ ...openai, model: 'gpt-4o-mini-tts', namedVoice: 'marin' });
    const asr = new SpeechToText({ ...openai, model: 'gpt-4o-mini-transcribe' });

    const audio = await tts.speak('New task. Man collapsed by the food stalls.', { voice: 'a calm Australian festival coordinator' });
    const { text } = await asr.transcribe(new Blob([audio], { type: 'audio/mpeg' }));

    expect(text.toLowerCase()).toContain('food stalls');
  });
});

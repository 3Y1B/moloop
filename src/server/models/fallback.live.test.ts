import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FallbackClassifier, FallbackLlm, FallbackSpeaker, FallbackTranscriber } from './fallback';
import { JevClassifier } from './jev';
import { LunaLlm } from './luna';
import { OpenAiDecisionsClassifier } from './openai-decisions';
import { SpeechToText, TextToSpeech } from './speech-clients';

const RouteResult = z.object({ decision: z.enum(['ai_resolved', 'escalated_to_triage']), reason: z.string() });

// Opt-in: with the Spark unreachable, every model call should be answered by real OpenAI. Run with
//   OPENAI_API_KEY=... npm test -- fallback.live
describe.skipIf(!process.env.OPENAI_API_KEY)('fallback to OpenAI when the Spark is down', () => {
  const deadSpark = { baseUrl: 'https://spark.invalid/v1', apiKey: 'unused', retryDelayMs: 0 };
  const openai = { baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY };

  it('chat: gpt-6-luna escalates a medical report', { timeout: 30_000 }, async () => {
    const llm = new FallbackLlm(new LunaLlm(deadSpark), new LunaLlm({ ...openai, model: 'gpt-6-luna' }));

    const route = await llm.generate({
      system: 'You triage festival reports. Anything involving injury, illness, children or safety MUST be escalated_to_triage.',
      prompt: 'Report: a guy collapsed by the food stalls',
      schema: RouteResult,
    });

    expect(route.decision).toBe('escalated_to_triage');
  });

  it('decisions: gpt-6-luna does not treat a collapse as routine', { timeout: 30_000 }, async () => {
    const classifier = new FallbackClassifier(new JevClassifier(deadSpark), new OpenAiDecisionsClassifier(openai));

    const r = await classifier.classify({
      text: 'a guy collapsed by the food stalls and is not responding',
      labels: [
        { id: 'P1', description: 'life threatening unconscious not breathing' },
        { id: 'P2', description: 'urgent injury needs help within minutes' },
        { id: 'P3', description: 'routine non urgent question' },
      ],
    });

    expect(r.label).not.toBe('P3');
  });

  it('speech: gpt-4o-mini-tts speaks a brief that gpt-4o-mini-transcribe hears back', { timeout: 60_000 }, async () => {
    const speaker = new FallbackSpeaker(new TextToSpeech({ ...deadSpark, model: 'qwen3-tts' }), new TextToSpeech({ ...openai, model: 'gpt-4o-mini-tts', namedVoice: 'marin' }));
    const transcriber = new FallbackTranscriber(new SpeechToText({ ...deadSpark, model: 'qwen3-asr-1.7b' }), new SpeechToText({ ...openai, model: 'gpt-4o-mini-transcribe' }));

    const audio = await speaker.speak('New task. Man collapsed by the food stalls.', { voice: 'a calm Australian festival coordinator' });
    const { text } = await transcriber.transcribe(new Blob([audio], { type: 'audio/mpeg' }));

    expect(text.toLowerCase()).toContain('food stalls');
  });
});

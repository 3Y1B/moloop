import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FallbackClassifier, FallbackLlm, FallbackSpeaker, FallbackTranscriber } from './fallback';
import type { Classifier, Llm, Speaker, Transcriber } from './types';

const Out = z.object({ title: z.string() });
const ask = { system: 's', prompt: 'p', schema: Out };

const llm = (id: string, behaviour: (args: { signal?: AbortSignal }) => Promise<unknown>): Llm => ({ id, generate: behaviour as Llm['generate'] });
const hangs = () => new Promise<never>(() => {});

describe('FallbackLlm.generate', () => {
  it('cancels the primary request when it times out, so a struggling Spark is not left doing the work', async () => {
    let seen: AbortSignal | undefined;
    const spark = llm('spark', (args) => {
      seen = args.signal;
      return hangs();
    });
    const both = new FallbackLlm(spark, llm('openai', async () => ({ title: 'from openai' })), { timeoutMs: 10 });

    await both.generate(ask);

    expect(seen?.aborted).toBe(true);
  });

  it("returns the primary's answer when it works", async () => {
    const both = new FallbackLlm(llm('spark', async () => ({ title: 'from spark' })), llm('mock', async () => ({ title: 'from mock' })));

    await expect(both.generate(ask)).resolves.toEqual({ title: 'from spark' });
  });

  it('uses the fallback when the primary fails', async () => {
    const both = new FallbackLlm(llm('spark', async () => { throw new Error('spark 502'); }), llm('mock', async () => ({ title: 'from mock' })));

    await expect(both.generate(ask)).resolves.toEqual({ title: 'from mock' });
  });

  it('uses the fallback when the primary hangs past the timeout', async () => {
    const both = new FallbackLlm(llm('spark', hangs), llm('mock', async () => ({ title: 'from mock' })), { timeoutMs: 10 });

    await expect(both.generate(ask)).resolves.toEqual({ title: 'from mock' });
  });
});

const LABELS = [{ id: 'P1', description: 'urgent' }, { id: 'P3', description: 'routine' }] as const;
const answer = (label: 'P1' | 'P3') => async () => ({ label, confidence: 0.9, scores: { [label]: 0.9 } });
const classifier = (id: string, behaviour: () => Promise<unknown>): Classifier => ({ id, classify: behaviour as Classifier['classify'] });

describe('FallbackClassifier.classify', () => {
  it("returns the primary's answer when it works", async () => {
    const both = new FallbackClassifier(classifier('jev', answer('P1')), classifier('mock', answer('P3')));

    await expect(both.classify({ text: 't', labels: LABELS })).resolves.toMatchObject({ label: 'P1' });
  });

  it('uses the fallback when the primary hangs past the timeout', async () => {
    const both = new FallbackClassifier(classifier('jev', hangs), classifier('mock', answer('P3')), { timeoutMs: 10 });

    await expect(both.classify({ text: 't', labels: LABELS })).resolves.toMatchObject({ label: 'P3' });
  });
});

const transcriber = (id: string, behaviour: () => Promise<{ text: string }>): Transcriber => ({ id, transcribe: behaviour });
const speaker = (id: string, behaviour: () => Promise<ArrayBuffer>): Speaker => ({ id, speak: behaviour });
const clip = new Blob([new Uint8Array([1])]);

describe('FallbackTranscriber.transcribe', () => {
  it('uses the fallback when the primary fails', async () => {
    const both = new FallbackTranscriber(transcriber('qwen3-asr', async () => { throw new Error('spark 502'); }), transcriber('openai', async () => ({ text: 'from openai' })));

    await expect(both.transcribe(clip)).resolves.toEqual({ text: 'from openai' });
  });
});

describe('FallbackSpeaker.speak', () => {
  it('uses the fallback when the primary hangs past the timeout', async () => {
    const audio = new Uint8Array([9]).buffer;
    const both = new FallbackSpeaker(speaker('qwen3-tts', hangs), speaker('openai', async () => audio), { timeoutMs: 10 });

    await expect(both.speak('hi', { voice: 'calm' })).resolves.toBe(audio);
  });
});

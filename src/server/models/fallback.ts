import type { z } from 'zod';
import type { Classifier, Llm, Speaker, Transcriber } from './types';

type FallbackOptions = { timeoutMs?: number };

// Sized for a chat call (~2 s on the Spark) plus one repair round; callers pass tighter or looser limits per job.
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Try the primary model; if it errors or hangs past the timeout, answer with the fallback instead.
 * On timeout the primary's request is aborted, so a struggling Spark isn't left working on an answer nobody will use.
 */
async function withFallback<R>(
  primary: { id: string; call: (signal: AbortSignal) => Promise<R> },
  fallback: () => Promise<R>,
  timeoutMs: number,
): Promise<R> {
  const cancel = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      cancel.abort();
      reject(new Error(`${primary.id} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([primary.call(cancel.signal), timeout]);
  } catch (e) {
    console.warn(`model ${primary.id} failed, using fallback:`, (e as Error).message);
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

export class FallbackLlm implements Llm {
  readonly id: string;
  private readonly timeoutMs: number;

  constructor(private readonly primary: Llm, private readonly fallback: Llm, opts: FallbackOptions = {}) {
    this.id = primary.id;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  generate<T extends z.ZodTypeAny>(args: { system: string; prompt: string; schema: T; signal?: AbortSignal }): Promise<z.infer<T>> {
    return withFallback({ id: this.primary.id, call: (signal) => this.primary.generate({ ...args, signal }) }, () => this.fallback.generate(args), this.timeoutMs);
  }
}

export class FallbackClassifier implements Classifier {
  readonly id: string;
  private readonly timeoutMs: number;

  constructor(private readonly primary: Classifier, private readonly fallback: Classifier, opts: FallbackOptions = {}) {
    this.id = primary.id;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  classify<L extends string>(input: { text: string; labels: readonly { id: L; description: string }[]; signal?: AbortSignal }) {
    return withFallback({ id: this.primary.id, call: (signal) => this.primary.classify({ ...input, signal }) }, () => this.fallback.classify(input), this.timeoutMs);
  }
}

export class FallbackTranscriber implements Transcriber {
  readonly id: string;
  private readonly timeoutMs: number;

  constructor(private readonly primary: Transcriber, private readonly fallback: Transcriber, opts: FallbackOptions = {}) {
    this.id = primary.id;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  transcribe(audio: Blob, opts?: { prompt?: string; signal?: AbortSignal }) {
    return withFallback({ id: this.primary.id, call: (signal) => this.primary.transcribe(audio, { ...opts, signal }) }, () => this.fallback.transcribe(audio, opts), this.timeoutMs);
  }
}

export class FallbackSpeaker implements Speaker {
  readonly id: string;
  private readonly timeoutMs: number;

  constructor(private readonly primary: Speaker, private readonly fallback: Speaker, opts: FallbackOptions = {}) {
    this.id = primary.id;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  speak(text: string, opts: { voice: string; signal?: AbortSignal }) {
    return withFallback({ id: this.primary.id, call: (signal) => this.primary.speak(text, { ...opts, signal }) }, () => this.fallback.speak(text, opts), this.timeoutMs);
  }
}

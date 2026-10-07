import type { z } from 'zod';

/**
 * Two model seams, so "Jev" and "GPT 6 Luna" are swappable and mockable:
 *  - Classifier: fast, cheap, label-in/label-out (team + priority).
 *  - Llm: generative + structured output (route, rewrite, P3 reply, assignment reasoning).
 */
// Every call takes an optional `signal`; aborting it cancels the in-flight request (the fallback does this on timeout).
export interface Classifier {
  readonly id: string;
  classify<L extends string>(input: { text: string; labels: readonly { id: L; description: string }[]; signal?: AbortSignal }): Promise<{
    label: L;
    confidence: number;
    scores: Record<string, number>;
  }>;
}

export interface Llm {
  readonly id: string;
  /** Structured output validated against a zod schema. Implementations must retry/repair on parse failure. */
  generate<T extends z.ZodTypeAny>(args: { system: string; prompt: string; schema: T; signal?: AbortSignal }): Promise<z.infer<T>>;
}

/** Speech in: an audio clip to text. `prompt` hints names and jargon (zones, team names). */
export interface Transcriber {
  readonly id: string;
  transcribe(audio: Blob, opts?: { prompt?: string; signal?: AbortSignal }): Promise<{ text: string }>;
}

/** Speech out: text to audio (mp3 bytes). `voice` is a plain-language description of how it should sound. */
export interface Speaker {
  readonly id: string;
  speak(text: string, opts: { voice: string; signal?: AbortSignal }): Promise<ArrayBuffer>;
}

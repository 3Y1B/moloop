import type { z } from 'zod';

/**
 * Two model seams, so "Jev" and "GPT 6 Luna" are swappable and mockable:
 *  - Classifier: fast, cheap, label-in/label-out (team + priority).
 *  - Llm: generative + structured output (route, rewrite, P3 reply, assignment reasoning).
 */
export interface Classifier {
  readonly id: string;
  classify<L extends string>(input: { text: string; labels: readonly { id: L; description: string }[] }): Promise<{
    label: L;
    confidence: number;
    scores: Record<string, number>;
  }>;
}

export interface Llm {
  readonly id: string;
  /** Structured output validated against a zod schema. Implementations must retry/repair on parse failure. */
  generate<T extends z.ZodTypeAny>(args: { system: string; prompt: string; schema: T }): Promise<z.infer<T>>;
}

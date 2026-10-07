import type { EntryType, Questions } from '@typesafe-ai/sdk';

import { checkAnswers, type Answers } from './decisions';
import { httpOptions, postWithRetry, type HttpOptions } from './http';
import { spark } from './providers';

type JevOptions = { baseUrl?: string; apiKey?: string; fetch?: typeof fetch; retryDelayMs?: number };

/** Spark's Jev-style typed decisions, POST /v1/systemone (docs/local-llm-api-docs.md). */
export class Jev {
  readonly id = 'qwen3.5:4b';
  private readonly http: HttpOptions;

  constructor(opts: JevOptions = {}) {
    this.http = httpOptions(opts, spark());
  }

  async decide<const Q extends Questions>(state: EntryType, questions: Q, signal?: AbortSignal): Promise<Answers<Q>> {
    const res = await postWithRetry(this.http, '/systemone', JSON.stringify({ model: 'jev-latest', state, questions }), signal);
    const { answers } = (await res.json()) as { answers: Answers<Q> };
    return checkAnswers(this.id, questions, answers);
  }
}

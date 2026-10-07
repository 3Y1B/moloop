import { httpOptions, postWithRetry, type HttpOptions } from './http';
import type { Classifier } from './types';

type JevOptions = { baseUrl?: string; apiKey?: string; fetch?: typeof fetch; retryDelayMs?: number };

type ChoiceAnswer = { choice: string; probabilities: Record<string, number>; confidence: number };

/** Spark's Jev-style typed decisions, POST /v1/systemone (docs/local-llm-api-docs.md). */
export class JevClassifier implements Classifier {
  readonly id = 'jev';
  private readonly http: HttpOptions;

  constructor(opts: JevOptions = {}) {
    this.http = httpOptions(opts, {
      baseUrl: process.env.SPARK_BASE_URL ?? 'https://spark-2053.taild1460f.ts.net/v1',
      apiKey: process.env.SPARK_API_KEY,
    });
  }

  async classify<L extends string>({ text, labels, signal }: { text: string; labels: readonly { id: L; description: string }[]; signal?: AbortSignal }) {
    const res = await postWithRetry(
      this.http,
      '/systemone',
      JSON.stringify({
        model: 'jev-latest',
        state: text,
        questions: {
          label: {
            type: 'choice',
            instructions: 'Which option best describes this festival report?',
            criteria: Object.fromEntries(labels.map((l) => [l.id, l.description])),
          },
        },
      }),
      signal,
    );
    const { answers } = (await res.json()) as { answers: { label: ChoiceAnswer } };
    const { choice, probabilities, confidence } = answers.label;
    const label = labels.find((l) => l.id === choice);
    if (!label) throw new Error(`jev chose "${choice}", which is not one of ${labels.map((l) => l.id).join(', ')}`);
    return { label: label.id, scores: probabilities, confidence };
  }
}

import { httpOptions, postWithRetry, type HttpOptions } from './http';
import type { Classifier } from './types';

type Options = { baseUrl?: string; apiKey?: string; model?: string; fetch?: typeof fetch; retryDelayMs?: number };

type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: { value: string; probability: number }[]; confidence: number };

/** OpenAI's Decisions API (POST /v1/decisions): the cloud stand-in for the Spark's Jev-style /v1/systemone. */
export class OpenAiDecisionsClassifier implements Classifier {
  readonly id: string;
  private readonly http: HttpOptions;

  constructor(opts: Options = {}) {
    this.id = opts.model ?? 'gpt-6-luna';
    this.http = httpOptions(opts, { baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY });
  }

  async classify<L extends string>({ text, labels, signal }: { text: string; labels: readonly { id: L; description: string }[]; signal?: AbortSignal }) {
    const res = await postWithRetry(
      this.http,
      '/decisions',
      JSON.stringify({
        model: this.id,
        input: text,
        questions: [
          {
            type: 'choice',
            name: 'label',
            instructions: 'Which option best describes this festival report?',
            choices: labels.map((l) => ({ value: l.id, description: l.description })),
          },
        ],
      }),
      signal,
    );
    const { answers } = (await res.json()) as { answers: (ChoiceAnswer | { type: 'refusal' })[] };
    const answer = answers[0];
    if (answer.type !== 'choice') throw new Error(`${this.id} refused to classify`);
    const label = labels.find((l) => l.id === answer.choice);
    if (!label) throw new Error(`${this.id} chose "${answer.choice}", which is not one of ${labels.map((l) => l.id).join(', ')}`);
    return {
      label: label.id,
      scores: Object.fromEntries(answer.probabilities.map((p) => [p.value, p.probability])),
      confidence: answer.confidence,
    };
  }
}

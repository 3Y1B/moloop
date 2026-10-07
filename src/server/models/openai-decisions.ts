import type { EntryType, Questions } from '@typesafe-ai/sdk';

import { checkAnswers, type Answers } from './decisions';
import { httpOptions, postWithRetry, type HttpOptions } from './http';
import { openai } from './providers';

type Options = { baseUrl?: string; apiKey?: string; model?: string; fetch?: typeof fetch; retryDelayMs?: number };

type Wire = { type: 'choice'; name: string; instructions?: string; choices: { value: string; description?: string }[] };
type Reply =
  | { type: 'choice'; name?: string; choice: string; probabilities: { value: string; probability: number }[]; confidence: number }
  | { type: 'refusal'; name?: string };

const text = (e: EntryType) => (typeof e === 'string' ? e : JSON.stringify(e));
const described = (value: string, d: EntryType | undefined) => (d == null ? { value } : { value, description: text(d) });

/**
 * OpenAI's Decisions API (POST /v1/decisions), answering the same typed questions as the Spark's /v1/systemone.
 * It only takes choices, so a yes/no (`noul`) question goes as a yes/no choice and comes back as the chance of yes.
 */
export class OpenAiDecisions {
  readonly id: string;
  private readonly http: HttpOptions;

  constructor(opts: Options = {}) {
    this.id = opts.model ?? 'gpt-6-luna';
    this.http = httpOptions(opts, openai());
  }

  async decide<const Q extends Questions>(state: EntryType, questions: Q, signal?: AbortSignal): Promise<Answers<Q>> {
    const wire: Wire[] = Object.entries(questions).map(([name, q]) => {
      const instructions = q.instructions == null ? {} : { instructions: text(q.instructions) };
      if (q.type === 'choice') return { type: 'choice', name, ...instructions, choices: Object.entries(q.criteria).map(([v, d]) => described(v, d)) };
      if (q.type === 'noul') return { type: 'choice', name, ...instructions, choices: [described('yes', q.criteria?.true), described('no', q.criteria?.false)] };
      throw new Error(`${this.id}: ${q.type} questions aren't supported`);
    });
    const res = await postWithRetry(this.http, '/decisions', JSON.stringify({ model: this.id, input: text(state), questions: wire }), signal);
    const { answers } = (await res.json()) as { answers: Reply[] };

    const out: Record<string, unknown> = {};
    wire.forEach(({ name }, i) => {
      const a = answers.find((x) => x.name === name) ?? answers[i];
      if (!a || a.type !== 'choice') throw new Error(`${this.id} refused to answer "${name}"`);
      const probabilities = Object.fromEntries(a.probabilities.map((p) => [p.value, p.probability]));
      out[name] = questions[name].type === 'noul'
        ? { type: 'noul', noul: probabilities.yes ?? (a.choice === 'yes' ? 1 : 0) }
        : { type: 'choice', choice: a.choice, probabilities, confidence: a.confidence };
    });
    return checkAnswers(this.id, questions, out as Answers<Q>);
  }
}

import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

export type Answers<Q extends Questions> = SystemOneResult<Q>['answers'];

/** Rejects a choice the caller never offered, so a confused model fails instead of steering the pipeline. */
export function checkAnswers<Q extends Questions>(id: string, questions: Q, answers: Answers<Q>): Answers<Q> {
  for (const [name, q] of Object.entries(questions)) {
    const a = answers[name] as { type: string; choice?: string; noul?: number } | undefined;
    if (!a) throw new Error(`${id} gave no answer to "${name}"`);
    if (q.type === 'choice' && !(a.choice! in q.criteria)) {
      throw new Error(`${id} chose "${a.choice}", which is not one of ${Object.keys(q.criteria).join(', ')}`);
    }
    if (q.type === 'noul' && typeof a.noul !== 'number') throw new Error(`${id} gave no probability for "${name}"`);
  }
  return answers;
}

import type { Classifier } from './types';

// TODO(jev): wire the real Jev endpoint. Env: JEV_API_URL, JEV_API_KEY. Contract assumed: POST {text, labels} -> {label, scores}.
export class JevClassifier implements Classifier {
  readonly id = 'jev';
  async classify<L extends string>(input: Parameters<Classifier['classify']>[0] & { labels: readonly { id: L; description: string }[] }) {
    const res = await fetch(process.env.JEV_API_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.JEV_API_KEY}` },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`jev ${res.status}`);
    const { label, scores } = (await res.json()) as { label: L; scores: Record<string, number> };
    return { label, scores, confidence: scores[label] ?? 0 };
  }
}

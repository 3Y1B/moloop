import type { z } from 'zod';
import type { Classifier, Llm } from './types';

// Keyword heuristics so the whole loop demos with no keys. Replace via models/index.ts.
const HIGH = /(unconscious|not breathing|seizure|bleeding|collapsed|chest pain|missing child|lost (my )?(child|kid|son|daughter)|fight|weapon)/i;
const INFO = /(where|toilet|bathroom|water|what time|lost property|schedule|how do i|which stage)/i;

export class MockClassifier implements Classifier {
  readonly id = 'mock-classifier';
  async classify<L extends string>({ text, labels }: { text: string; labels: readonly { id: L; description: string }[] }) {
    const lower = text.toLowerCase();
    const scored = labels.map((l) => ({
      id: l.id,
      s: l.description.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && lower.includes(w)).length,
    }));
    scored.sort((a, b) => b.s - a.s);
    const top = scored[0];
    const scores = Object.fromEntries(scored.map((x) => [x.id, x.s ? 0.6 + Math.min(0.3, x.s * 0.1) : 0.1]));
    return { label: top.id, confidence: scores[top.id], scores };
  }
}

export class MockLlm implements Llm {
  readonly id = 'mock-llm';
  async generate<T extends z.ZodTypeAny>({ prompt, schema }: { system: string; prompt: string; schema: T }): Promise<z.infer<T>> {
    const critical = HIGH.test(prompt);
    const info = !critical && INFO.test(prompt);
    // The mock returns a loose shape per stage; the schema parse below is the real contract check.
    const guess: Record<string, unknown> = {
      decision: info ? 'ai_resolved' : 'escalated_to_triage',
      reason: info ? 'Routine information request' : 'Possible incident',
      confidence: 0.75,
      detectedLanguage: 'en',
      textEn: prompt.slice(0, 300),
      reply: 'Thanks, the nearest help point is the Info Tent by Gate A.',
      language: 'en',
      escalate: false,
      title: prompt.slice(0, 55),
      summary: prompt.slice(0, 270),
      category: critical ? 'medical' : info ? 'info_request' : 'other',
      zoneSlug: null,
      locationHint: null,
      requiredSkills: critical ? ['first-aid-cert'] : [],
      peopleInvolved: null,
      candidates: [],
      requiresApproval: true,
    };
    return schema.parse(guess);
  }
}

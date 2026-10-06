import type { z } from 'zod';
import type { Llm } from './types';

// TODO(luna): wire the real "GPT 6 Luna" client. Route via Vercel AI Gateway or the provider SDK; use its JSON-schema/structured-output mode.
export class LunaLlm implements Llm {
  readonly id = process.env.LLM_MODEL ?? 'gpt-6-luna';
  async generate<T extends z.ZodTypeAny>(_args: { system: string; prompt: string; schema: T }): Promise<z.infer<T>> {
    throw new Error('LunaLlm.generate not implemented yet');
  }
}

import { Limiter } from './limiter';

/**
 * Where the models run. Keys live in the server's env only.
 *
 *  - OpenAI (default): every call, with OPENAI_API_KEY.
 *  - MODEL_PROVIDER=spark: the Spark first (SPARK_API_KEY), then OpenAI when it fails or runs late.
 *    Chat stays on OpenAI either way.
 *
 *   chat + JSON     gpt-6-luna only (reasoning off)
 *   typed decisions /v1/systemone     -> /v1/decisions, gpt-6-luna
 *   speech to text  qwen3-asr-1.7b    -> gpt-4o-mini-transcribe
 *   text to speech  qwen3-tts         -> gpt-4o-mini-tts, voice "marin" with a described manner
 */
const trim = (s: string) => s.replace(/\/+$/, '');

export const spark = () => ({
  baseUrl: trim(process.env.SPARK_BASE_URL ?? 'https://spark-2053.taild1460f.ts.net/v1'),
  apiKey: process.env.SPARK_API_KEY,
});
export const openai = () => ({ baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY });

export const onSpark = () => process.env.MODEL_PROVIDER === 'spark' && !!process.env.SPARK_API_KEY;
export const hasOpenAi = () => !!process.env.OPENAI_API_KEY;

export type ModelIdentity = { provider: 'openai' | 'configured'; model: string };
export type ChatProvider = ModelIdentity & { baseUrl: string; apiKey: string | undefined; reasoningEffort: string };

/** Chat runs on OpenAI gpt-6-luna, reasoning off. */
export const chatProviders = (): ChatProvider[] =>
  hasOpenAi() ? [{ provider: 'openai', ...openai(), model: 'gpt-6-luna', reasoningEffort: 'none' }] : [];

export const chatModelReadiness = (): { ready: boolean; model: string; missing: string[] } =>
  ({ ready: hasOpenAi(), model: 'gpt-6-luna', missing: hasOpenAi() ? [] : ['OPENAI_API_KEY'] });

/**
 * Mobilization calls OpenAI's /responses, so it never goes to the Spark. MOBILIZATION_BASE_URL (+ MOBILIZATION_API_KEY)
 * points it somewhere else, which scripts/check-mobilization-api.ts uses for its local fake model.
 */
export function mobilizationProviders(): { providers: ChatProvider[]; missing: string[] } {
  const base = process.env.MOBILIZATION_BASE_URL;
  if (base == null) {
    const providers = chatProviders();
    return { providers, missing: providers.length ? [] : ['OPENAI_API_KEY'] };
  }
  const provider: ChatProvider = { provider: 'configured', baseUrl: trim(base), apiKey: process.env.MOBILIZATION_API_KEY,
    model: 'gpt-6-luna', reasoningEffort: 'none' };
  let local = false;
  try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(provider.baseUrl).hostname); }
  catch { return { providers: [], missing: ['MOBILIZATION_BASE_URL'] }; }
  return !local && !provider.apiKey?.trim()
    ? { providers: [], missing: ['MOBILIZATION_API_KEY'] }
    : { providers: [provider], missing: [] };
}

let limiter: Limiter | undefined;
/** One queue in front of the Spark, shared by chat, decisions and speech: one key counts them all. */
export const sparkLimiter = () =>
  (limiter ??= new Limiter(Number(process.env.SPARK_CONCURRENCY ?? 3), Number(process.env.SPARK_RPM ?? 95)));

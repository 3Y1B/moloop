import { Limiter } from './limiter';

/**
 * Where the models run. Keys live in the server's env only.
 *
 *  - OpenAI (default): every call, with OPENAI_API_KEY.
 *  - MODEL_PROVIDER=spark: the Spark first (SPARK_API_KEY), then OpenAI when it fails or runs late.
 *    Chat stays on OpenAI either way.
 *
 *   chat + JSON     gpt-6-luna (or explicit LLM_* structured-chat override)
 *   typed decisions /v1/systemone     -> /v1/decisions, gpt-6-luna
 *   speech to text  qwen3-asr-1.7b    -> gpt-4o-mini-transcribe
 *   text to speech  qwen3-tts         -> gpt-4o-mini-tts, voice "marin" with a described manner
 */
const trim = (s: string) => s.replace(/\/+$/, '');
const versioned = (s: string) => `${trim(s).replace(/\/v1$/, '')}/v1`;

export const spark = () => ({
  baseUrl: process.env.SPARK_BASE_URL != null ? trim(process.env.SPARK_BASE_URL)
    : process.env.TYPESAFE_BASE_URL != null ? versioned(process.env.TYPESAFE_BASE_URL)
    : 'https://spark-2053.taild1460f.ts.net/v1',
  apiKey: process.env.SPARK_API_KEY ?? process.env.TYPESAFE_API_KEY,
});
export const openai = () => ({ baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY });

export const onSpark = () => (process.env.MODEL_PROVIDER === 'spark' ||
  (process.env.MODEL_PROVIDER == null && !!process.env.TYPESAFE_BASE_URL)) && !!spark().apiKey;
export const hasOpenAi = () => !!process.env.OPENAI_API_KEY;

export type ModelIdentity = { provider: 'configured' | 'spark' | 'openai' | 'openrouter'; model: string };
export type ChatProvider = ModelIdentity & { baseUrl: string; apiKey: string | undefined; reasoningEffort: string };

/** One source of truth for structured-chat selection, readiness and actual request construction. */
export function chatProviders(): ChatProvider[] {
  if (process.env.LLM_BASE_URL != null || process.env.OPENROUTER_API_KEY) {
    const baseUrl = trim(process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1');
    const directOpenAi = baseUrl.startsWith('https://api.openai.com/');
    return [{ provider: process.env.LLM_BASE_URL != null ? 'configured' : 'openrouter', baseUrl,
      apiKey: process.env.LLM_API_KEY ?? process.env.OPENROUTER_API_KEY ??
        (directOpenAi ? process.env.OPENAI_API_KEY : process.env.TYPESAFE_API_KEY),
      model: process.env.LLM_MODEL ?? (directOpenAi ? 'gpt-6-luna' : process.env.OPENROUTER_API_KEY ? 'openai/gpt-6-luna' : 'qwen3.5:4b'),
      reasoningEffort: process.env.LLM_REASONING_EFFORT ?? 'none' }];
  }
  // MODEL_PROVIDER selects the typed/speech Spark seam, not the structured-chat model.
  return hasOpenAi() ? [{ provider: 'openai', ...openai(), model: 'gpt-6-luna', reasoningEffort: 'none' }] : [];
}

function missingFor(provider: ChatProvider): string[] {
  const missing: string[] = [];
  let local = false;
  try {
    const endpoint = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol)) missing.push('HTTP model endpoint');
    local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username || endpoint.password) missing.push('Model endpoint without embedded credentials');
  } catch { missing.push('LLM_BASE_URL or SPARK_BASE_URL'); }
  if (!local && !provider.apiKey?.trim()) missing.push('Server-side model API key');
  if (!provider.model.trim()) missing.push('LLM_MODEL');
  return missing;
}

export function chatModelReadiness(): { ready: boolean; model: string; missing: string[] } {
  const providers = chatProviders();
  const ready = providers.find((provider) => missingFor(provider).length === 0);
  return { ready: !!ready, model: ready?.model ?? providers[0]?.model ?? 'gpt-6-luna',
    missing: ready ? [] : providers.length ? [...new Set(providers.flatMap(missingFor))]
      : ['OPENAI_API_KEY, or configured LLM_BASE_URL/API key'] };
}

export const configuredChatProviders = () => chatProviders().filter((provider) => missingFor(provider).length === 0);

/** Starting the API requires a real usable model seam, not a keyword-only mode or copied credentials. */
export const serverModelReady = () => chatModelReadiness().ready || hasOpenAi() || onSpark();

let limiter: Limiter | undefined;
/** One queue in front of the Spark, shared by chat, decisions and speech: one key counts them all. */
export const sparkLimiter = () =>
  (limiter ??= new Limiter(Number(process.env.SPARK_CONCURRENCY ?? 3), Number(process.env.SPARK_RPM ?? 95)));

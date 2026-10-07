import { Limiter } from './limiter';

/**
 * Where the models run. Keys live in the server's env only.
 *
 *  - OpenAI (default): every call, with OPENAI_API_KEY.
 *  - MODEL_PROVIDER=spark: the Spark first (SPARK_API_KEY), then OpenAI when it fails or runs late.
 *
 *   chat + JSON     qwen3.5:4b        -> gpt-6-luna (reasoning off)
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

let limiter: Limiter | undefined;
/** One queue in front of the Spark, shared by chat, decisions and speech: one key counts them all. */
export const sparkLimiter = () =>
  (limiter ??= new Limiter(Number(process.env.SPARK_CONCURRENCY ?? 3), Number(process.env.SPARK_RPM ?? 95)));

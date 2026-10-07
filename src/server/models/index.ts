import type { Classifier, Llm, Speaker, Transcriber } from './types';
import { FallbackClassifier, FallbackLlm, FallbackSpeaker, FallbackTranscriber } from './fallback';
import { JevClassifier } from './jev';
import { LunaLlm } from './luna';
import { MockClassifier, MockLlm } from './mock';
import { OpenAiDecisionsClassifier } from './openai-decisions';
import { SpeechToText, TextToSpeech } from './speech-clients';

/**
 * Live models run on the Spark (open-source, self-hosted). If the Spark errors or passes its time limit (the request
 * is then cancelled), each call falls back to the closest OpenAI model; if that fails too, the error reaches the
 * pipeline, which fails closed to a human.
 *
 *   chat + JSON     qwen3.5:4b        -> gpt-6-luna (reasoning off)
 *   Jev decisions   /v1/systemone     -> /v1/decisions, gpt-6-luna
 *   speech to text  qwen3-asr-1.7b    -> gpt-4o-mini-transcribe
 *   text to speech  qwen3-tts         -> gpt-4o-mini-tts, voice "marin" + the description as instructions
 */
const live = process.env.USE_LIVE_MODELS === '1';

const SPARK = { baseUrl: process.env.SPARK_BASE_URL ?? 'https://spark-2053.taild1460f.ts.net/v1', apiKey: process.env.SPARK_API_KEY };
const OPENAI = { baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY };

export const classifier: Classifier = live
  ? new FallbackClassifier(new JevClassifier(SPARK), new OpenAiDecisionsClassifier(OPENAI), { timeoutMs: 4_000 })
  : new MockClassifier();

export const llm: Llm = live
  ? new FallbackLlm(new LunaLlm(SPARK), new LunaLlm({ ...OPENAI, model: 'gpt-6-luna' }), { timeoutMs: 5_000 })
  : new MockLlm();

// No offline mock for audio: these are only used once voice is wired (phase 4).
export const transcriber: Transcriber = new FallbackTranscriber(
  new SpeechToText({ ...SPARK, model: 'qwen3-asr-1.7b' }),
  new SpeechToText({ ...OPENAI, model: 'gpt-4o-mini-transcribe' }),
  { timeoutMs: 8_000 },
);

// Spoken briefs can run several sentences; qwen3-tts renders at ~1.4x realtime.
export const speaker: Speaker = new FallbackSpeaker(
  new TextToSpeech({ ...SPARK, model: 'qwen3-tts' }),
  new TextToSpeech({ ...OPENAI, model: 'gpt-4o-mini-tts', namedVoice: 'marin' }),
  { timeoutMs: 12_000 },
);

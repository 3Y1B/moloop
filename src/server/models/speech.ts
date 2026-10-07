import { withFallback, type Attempt } from './fallback';
import { Limiter } from './limiter';
import { hasOpenAi, onSpark, openai, spark, sparkLimiter } from './providers';
import { SpeechToText, TextToSpeech } from './speech-clients';

/**
 * The speech models, OpenAI-shaped (docs/local-llm-api-docs.md):
 *
 *  - `transcribe`: `/v1/audio/transcriptions`. No keyword stand-in: without a speech model, voice is off and typing
 *    still works.
 *  - `speak`: `/v1/audio/speech`. Whole file at once, mp3.
 *
 * Transcription is OpenAI (gpt-4o-mini-transcribe). Text to speech is OpenAI (gpt-4o-mini-tts) by default, and with
 * MODEL_PROVIDER=spark Qwen3-TTS 1.7B on the Spark first, sharing its queue with chat and decisions, then OpenAI.
 * SPEECH_BASE_URL puts a server of our own first instead, such as mlx-audio on this machine (`mlx_audio.server`) with
 * the same Qwen3 models under their Hugging Face names; it has no rate limit. ASR_PROVIDER=qwen sends transcription to
 * that first server too (Qwen3-ASR 1.7B), and so does having no OpenAI key.
 */

const local = () => !!process.env.SPEECH_BASE_URL;

/** The Qwen server tried first, if any: our own, else the Spark when it's the provider. */
const qwen = () => local()
  ? {
    base: process.env.SPEECH_BASE_URL!.replace(/\/+$/, ''),
    key: process.env.SPEECH_API_KEY ?? '',
    asr: process.env.ASR_MODEL ?? 'mlx-community/Qwen3-ASR-1.7B-8bit',
    tts: process.env.TTS_MODEL ?? 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit',
    // A named speaker; mlx-audio has no described voices.
    voice: process.env.TTS_VOICE ?? 'ryan',
    // mlx-audio calls the vocabulary hint `context`.
    hint: 'context',
    // mlx-audio decodes any format by its content, then rewrites it to a temp file named like the upload, which it
    // can't do for m4a (the phone's format). Calling every clip .wav sidesteps that.
    rename: 'clip.wav',
    limiter: (localLimiter ??= new Limiter(2, 600)),
  }
  : onSpark()
    ? {
      base: spark().baseUrl,
      key: spark().apiKey ?? '',
      asr: process.env.ASR_MODEL ?? 'qwen3-asr-1.7b',
      tts: process.env.TTS_MODEL ?? 'qwen3-tts',
      // Same description, same voice: Spark seeds from it, so every brief sounds like the same person.
      voice: process.env.TTS_VOICE ?? 'jarvis',
      hint: 'prompt',
      rename: null,
      limiter: sparkLimiter(),
    }
    : null;

let localLimiter: Limiter | undefined;

/** Text to speech goes to the Qwen server first, when there is one. */
const primaryTts = () => qwen();
/** Transcription stays on OpenAI unless asked for, or unless OpenAI isn't there. */
const primaryAsr = () => (process.env.ASR_PROVIDER === 'qwen' || !hasOpenAi() ? qwen() : null);

// gpt-4o-mini-tts takes a named voice, and how to say things as instructions.
const MANNER = 'Calm, clear and unhurried, like a steady festival radio dispatcher.';
const OPENAI_ASR = 'gpt-4o-mini-transcribe';
const OPENAI_TTS = 'gpt-4o-mini-tts';
let cloud: { asr: SpeechToText; tts: TextToSpeech } | undefined;
const openAi = () => (hasOpenAi()
  ? (cloud ??= {
    asr: new SpeechToText({ ...openai(), model: OPENAI_ASR }),
    tts: new TextToSpeech({ ...openai(), model: OPENAI_TTS, namedVoice: 'marin' }),
  })
  : null);

// How long the first server gets before OpenAI takes over, and how long the last resort gets.
const LIMITS = { transcribe: { primaryMs: 8_000, lastMs: 15_000 }, speak: { primaryMs: 12_000, lastMs: 30_000 } };

export const speechAvailable = () => local() || onSpark() || hasOpenAi();

/** Spoken briefs: a speech call per message, whenever there's a speech model. */
export const briefsEnabled = () => speechAvailable();

/** The models answering first, for the logs. */
export const speechModels = () => {
  return { asr: primaryAsr()?.asr ?? OPENAI_ASR, tts: primaryTts()?.tts ?? OPENAI_TTS };
};

const auth = (key: string): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set([408, 429, 500, 502, 503, 504]);

/** One call to the first server through its queue, retried on a busy server or a dropped connection. */
async function call(p: NonNullable<ReturnType<typeof qwen>>, path: string, init: () => RequestInit, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await p.limiter.run(true, () => fetch(`${p.base}${path}`, { ...init(), signal }), signal);
      if (RETRY.has(res.status) && attempt < 2) {
        await sleep(Math.min(Number(res.headers.get('retry-after') ?? 0) * 1000 || 300 * 2 ** attempt, 3_000));
        continue;
      }
      if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res;
    } catch (e) {
      if (attempt < 2 && e instanceof TypeError && !signal.aborted) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
}

/**
 * What someone said. `vocabulary` is a hint for names and places the recogniser wouldn't guess ("Tin Alley").
 * Always urgent: someone is standing there waiting for "Heard".
 */
export async function transcribe(audio: Blob, filename: string, vocabulary?: string): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const p = primaryAsr();
  const first: Attempt<{ text: string }> | null = p && {
    id: p.asr,
    call: async (signal) => {
      const res = await call(p, '/audio/transcriptions', () => {
        const form = new FormData();
        form.append('file', audio, p.rename ?? filename);
        form.append('model', p.asr);
        form.append('response_format', 'json');
        if (vocabulary) form.append(p.hint, vocabulary);
        return { method: 'POST', headers: auth(p.key), body: form };
      }, signal);
      const json = (await res.json()) as { text?: string };
      return { text: json.text ?? '' };
    },
  };
  const o = openAi();
  const { text } = await withFallback(
    first,
    o && { id: o.asr.id, call: (signal) => o.asr.transcribe(audio, { filename, prompt: vocabulary, signal }) },
    LIMITS.transcribe,
  );
  return { text: text.trim(), latencyMs: Date.now() - t0 };
}

/** A spoken message, as mp3. Up to 2,000 characters. */
export async function speak(text: string): Promise<ArrayBuffer> {
  const input = text.slice(0, 2000);
  const p = primaryTts();
  const o = openAi();
  return withFallback(
    p && {
      id: p.tts,
      call: async (signal) => (await call(p, '/audio/speech', () => ({
        method: 'POST',
        headers: { ...auth(p.key), 'content-type': 'application/json' },
        body: JSON.stringify({ model: p.tts, voice: p.voice, input, response_format: 'mp3' }),
      }), signal)).arrayBuffer(),
    },
    o && { id: o.tts.id, call: (signal) => o.tts.speak(input, { voice: MANNER, signal }) },
    LIMITS.speak,
  );
}

/**
 * A local speech server loads each model on its first call, which takes seconds (20 s or more for TTS). Load both at
 * boot so the first "Heard" and the first brief are as quick as the rest. Spark and OpenAI keep theirs loaded.
 */
export async function warmSpeech() {
  if (!local()) return;
  const t0 = Date.now();
  const audio = await speak('Ready.');
  if (primaryAsr()) await transcribe(new Blob([audio], { type: 'audio/mpeg' }), 'warm.mp3');
  console.log(`[voice] local speech models loaded in ${Date.now() - t0} ms`);
}

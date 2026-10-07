import { Limiter } from './limiter';
import { sparkLimiter } from './spark';

/**
 * The speech models, OpenAI-shaped (docs/local-llm-api-docs.md):
 *
 *  - `transcribe`: `/v1/audio/transcriptions` with Qwen3-ASR 1.7B. A 5 s clip takes about 0.2–0.6 s. No keyword
 *    stand-in: without a speech server, voice is off and typing still works.
 *  - `speak`: `/v1/audio/speech` with Qwen3-TTS 1.7B, about 1 s for a brief. Whole file at once, mp3.
 *
 * On Spark by default, sharing its queue with the typed decisions and chat: one key, 4 at once, 30 a minute.
 * SPEECH_BASE_URL moves both to another server, such as mlx-audio on this machine (`mlx_audio.server`), with the
 * same models under their Hugging Face names: decisions stay on Spark, speech has no rate limit.
 */

const local = () => !!process.env.SPEECH_BASE_URL;

const config = () => local()
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
  }
  : {
    base: `${(process.env.TYPESAFE_BASE_URL ?? '').replace(/\/+$/, '')}/v1`,
    key: process.env.TYPESAFE_API_KEY ?? '',
    asr: process.env.ASR_MODEL ?? 'qwen3-asr-1.7b',
    tts: process.env.TTS_MODEL ?? 'qwen3-tts',
    // Same description, same voice: Spark seeds from it, so every brief sounds like the same person.
    voice: process.env.TTS_VOICE ?? 'jarvis',
    hint: 'prompt',
    rename: null,
  };

let localLimiter: Limiter | undefined;
const limiter = () => (local() ? (localLimiter ??= new Limiter(2, 600)) : sparkLimiter());

/** Speech needs a speech server whatever USE_LIVE_MODELS says: there's nothing to fall back to. */
export const speechAvailable = () => local() || (!!process.env.TYPESAFE_BASE_URL && !!process.env.TYPESAFE_API_KEY);

/** Spoken briefs cost a speech call per message (on Spark, against its rate limit), so they come on with the rest of the live models. */
export const briefsEnabled = () => speechAvailable() && process.env.USE_LIVE_MODELS === '1';

export const speechModels = () => ({ asr: config().asr, tts: config().tts });

const auth = (key: string): Record<string, string> => (key ? { authorization: `Bearer ${key}` } : {});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY = new Set([408, 429, 500, 502, 503, 504]);

/** One speech call through the queue, retried on a busy server or a dropped connection like chat is. */
async function call(path: string, init: () => RequestInit, { timeoutMs, urgent }: { timeoutMs: number; urgent: boolean }) {
  const { base } = config();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await limiter().run(urgent, () =>
        fetch(`${base}${path}`, { ...init(), signal: AbortSignal.timeout(timeoutMs) }));
      if (RETRY.has(res.status) && attempt < 2) {
        await sleep(Math.min(Number(res.headers.get('retry-after') ?? 0) * 1000 || 300 * 2 ** attempt, 3_000));
        continue;
      }
      if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res;
    } catch (e) {
      if (attempt < 2 && e instanceof TypeError) {
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
  const c = config();
  const res = await call('/audio/transcriptions', () => {
    const form = new FormData();
    form.append('file', audio, c.rename ?? filename);
    form.append('model', c.asr);
    form.append('response_format', 'json');
    if (vocabulary) form.append(c.hint, vocabulary);
    return { method: 'POST', headers: auth(c.key), body: form };
  }, { timeoutMs: 15_000, urgent: true });
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? '').trim(), latencyMs: Date.now() - t0 };
}

/** A spoken message, as mp3. Up to 2,000 characters. */
export async function speak(text: string): Promise<ArrayBuffer> {
  const c = config();
  const res = await call('/audio/speech', () => ({
    method: 'POST',
    headers: { ...auth(c.key), 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.tts, voice: c.voice, input: text.slice(0, 2000), response_format: 'mp3' }),
  }), { timeoutMs: 30_000, urgent: true });
  return res.arrayBuffer();
}

/**
 * A local speech server loads each model on its first call, which takes seconds (20 s or more for TTS). Load both at
 * boot so the first "Heard" and the first brief are as quick as the rest. Spark keeps its models loaded: nothing to do.
 */
export async function warmSpeech() {
  if (!local()) return;
  const t0 = Date.now();
  const audio = await speak('Ready.');
  await transcribe(new Blob([audio], { type: 'audio/mpeg' }), 'warm.mp3');
  console.log(`[voice] local speech models loaded in ${Date.now() - t0} ms`);
}

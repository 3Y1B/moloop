import { httpOptions, postWithRetry, type HttpOptions } from './http';
import type { Speaker, Transcriber } from './types';

// Servers infer the audio format from the filename, and MIME subtypes aren't always the extension (audio/mpeg is mp3).
const EXTENSION: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a' };
const filename = (type: string) => `clip.${EXTENSION[type] ?? (type.split('/')[1] || 'webm')}`;

type Options = { baseUrl: string; apiKey: string | undefined; model: string; fetch?: typeof fetch; retryDelayMs?: number };

/** OpenAI-compatible POST /audio/transcriptions: the Spark's qwen3-asr and OpenAI's transcribe models share this shape. */
export class SpeechToText implements Transcriber {
  readonly id: string;
  private readonly http: HttpOptions;

  constructor(opts: Options) {
    this.id = opts.model;
    this.http = httpOptions(opts, opts);
  }

  async transcribe(audio: Blob, opts: { prompt?: string; signal?: AbortSignal } = {}) {
    const form = new FormData();
    form.append('model', this.id);
    form.append('file', audio, filename(audio.type));
    if (opts.prompt) form.append('prompt', opts.prompt);
    const res = await postWithRetry(this.http, '/audio/transcriptions', form, opts.signal);
    const { text } = (await res.json()) as { text: string };
    return { text };
  }
}

/**
 * OpenAI-compatible POST /audio/speech. The Spark's qwen3-tts takes a voice description in `voice`;
 * OpenAI's gpt-4o-mini-tts needs a named voice, so pass `namedVoice` and the description goes in `instructions`.
 */
export class TextToSpeech implements Speaker {
  readonly id: string;
  private readonly http: HttpOptions;
  private readonly namedVoice: string | undefined;

  constructor(opts: Options & { namedVoice?: string }) {
    this.id = opts.model;
    this.http = httpOptions(opts, opts);
    this.namedVoice = opts.namedVoice;
  }

  async speak(text: string, { voice, signal }: { voice: string; signal?: AbortSignal }) {
    const body = this.namedVoice
      ? { model: this.id, input: text, voice: this.namedVoice, instructions: voice }
      : { model: this.id, input: text, voice };
    const res = await postWithRetry(this.http, '/audio/speech', JSON.stringify(body), signal);
    return res.arrayBuffer();
  }
}

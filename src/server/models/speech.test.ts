import { describe, expect, it } from 'vitest';
import { fakeHttp, type FakeReply } from './fake-http';
import { SpeechToText, TextToSpeech } from './speech-clients';

const clip = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });

const stt = (...replies: FakeReply[]) => {
  const http = fakeHttp(...replies);
  const transcriber = new SpeechToText({ baseUrl: 'https://asr.test/v1', apiKey: 'k', model: 'qwen3-asr-1.7b', fetch: http.fetch, retryDelayMs: 0 });
  return { transcriber, requests: http.requests };
};

describe('SpeechToText.transcribe', () => {
  it.each([
    ['audio/mpeg', 'clip.mp3'],
    ['audio/mp4', 'clip.m4a'],
    ['audio/webm', 'clip.webm'],
    ['audio/wav', 'clip.wav'],
  ])('names a %s upload %s, so the server can tell the format', async (type, filename) => {
    const { transcriber, requests } = stt({ json: { text: 'ok' } });

    await transcriber.transcribe(new Blob([new Uint8Array([1])], { type }));

    expect((requests[0].form?.get('file') as File).name).toBe(filename);
  });

  it('uploads the clip with the model and vocabulary hint, and returns the text', async () => {
    const { transcriber, requests } = stt({ json: { text: 'man down by the food stalls' } });

    await expect(transcriber.transcribe(clip, { prompt: 'Vocabulary: Gate A, food alley' })).resolves.toEqual({ text: 'man down by the food stalls' });

    expect(requests).toHaveLength(1);
    const { url, headers, form } = requests[0];
    expect(url).toBe('https://asr.test/v1/audio/transcriptions');
    expect(headers.authorization).toBe('Bearer k');
    expect(form?.get('model')).toBe('qwen3-asr-1.7b');
    expect(form?.get('prompt')).toBe('Vocabulary: Gate A, food alley');
    expect(form?.get('file')).toBeInstanceOf(Blob);
  });
});

const VOICE = 'a calm Australian festival coordinator, clear and brisk';
const mp3 = new Uint8Array([0xff, 0xf3, 0x44]);

describe('TextToSpeech.speak', () => {
  it('describes the voice directly when the server takes descriptions (Spark qwen3-tts)', async () => {
    const http = fakeHttp({ bytes: mp3 });
    const tts = new TextToSpeech({ baseUrl: 'https://tts.test/v1', apiKey: 'k', model: 'qwen3-tts', fetch: http.fetch, retryDelayMs: 0 });

    const audio = await tts.speak('New task: man collapsed by the food stalls.', { voice: VOICE });

    expect(new Uint8Array(audio)).toEqual(mp3);
    expect(http.requests[0].url).toBe('https://tts.test/v1/audio/speech');
    expect(http.requests[0].json).toEqual({ model: 'qwen3-tts', input: 'New task: man collapsed by the food stalls.', voice: VOICE });
  });

  it('uses a named voice and passes the description as instructions (OpenAI gpt-4o-mini-tts)', async () => {
    const http = fakeHttp({ bytes: mp3 });
    const tts = new TextToSpeech({ baseUrl: 'https://tts.test/v1', apiKey: 'k', model: 'gpt-4o-mini-tts', namedVoice: 'marin', fetch: http.fetch, retryDelayMs: 0 });

    await tts.speak('New task.', { voice: VOICE });

    expect(http.requests[0].json).toEqual({ model: 'gpt-4o-mini-tts', input: 'New task.', voice: 'marin', instructions: VOICE });
  });
});

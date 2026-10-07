import type { Batch } from '@/lib/batch';
import type { Message } from '@/lib/schema';
import { db } from './db';
import { briefsEnabled, speak, speechModels, transcribe } from './models/speech';
import { zones } from './models/venue';
import { sql } from './world';

/**
 * Voice in and out (docs/PLAN-LIVE.md, phase 4).
 *
 *  - In: a hold of the pill arrives as one clip. It's transcribed by Spark and kept in the `voice` bucket at
 *    <caller>/<clip>.<ext>, so a report can point at what was actually said and a weird take can be replayed.
 *  - Out: every spoken message (a new task for someone idle, backup, next up) is rendered by Spark TTS after its
 *    transaction commits, kept in the `speech` bucket at <recipient>/<message>.mp3, and its delivery row points at
 *    it. The phone hears that over realtime and plays it if the app is open. The text is already there; the audio
 *    follows a couple of seconds later.
 */

export const MAX_CLIP_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/3gpp': '3gp',
};

function extension(file: File) {
  const named = /\.([a-z0-9]{2,4})$/i.exec(file.name)?.[1]?.toLowerCase();
  return named ?? EXT[file.type.split(';')[0]] ?? 'm4a';
}

/** A clip someone recorded, as its path in the `voice` bucket. Only the caller's own clips can go on what they report. */
export const ownClip = (callerId: string, path: string) => path.startsWith(`${callerId}/`) && !path.includes('..');

let names: { at: number; text: string; words: string[] } | undefined;

/** Places and people the recogniser wouldn't guess. Changes rarely: cached for a minute. */
async function vocabulary() {
  if (!names || Date.now() - names.at > 60_000) {
    const [zs, people] = await Promise.all([zones(), sql()<{ name: string }[]>`select split_part(full_name, ' ', 1) as name from profiles`]);
    const words = [...new Set([...zs.map((z) => z.name), ...people.map((p) => p.name), 'Moloop', 'Mo'])];
    names = { at: Date.now(), text: `Vocabulary: ${words.join(', ')}`.slice(0, 600), words };
  }
  return names;
}

const norm = (s: string) => s.toLowerCase().replace(/^vocabulary:\s*/, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Given silence or noise, the recogniser can read its hint back ("Backstage, First Aid, Food Alley, ...").
 * That's nothing said: a transcript that is mostly a run of hint words counts as empty.
 */
export function echoesHint(text: string, words: string[]) {
  const known = new Set(words.map(norm));
  const parts = text.split(/[,.;\n]+/).map(norm).filter(Boolean);
  return parts.length >= 3 && parts.filter((p) => known.has(p)).length / parts.length >= 0.6;
}

/**
 * What a clip says, and where it's kept. Keeping it never holds up "Heard": the upload runs beside the
 * transcription, and a failed upload only means the report has no clip.
 */
export async function hear(callerId: string, file: File): Promise<{ text: string; clip: string | null }> {
  const path = `${callerId}/${crypto.randomUUID()}.${extension(file)}`;
  const kept = db().storage.from('voice').upload(path, file, { contentType: file.type || 'audio/mp4' })
    .then(({ error }) => {
      if (error) throw error;
      return path;
    })
    .catch((e) => {
      console.error('keeping a voice clip failed', e);
      return null;
    });
  const hint = await vocabulary().catch(() => undefined);
  const [heard, clip] = await Promise.all([transcribe(file, `clip.${extension(file)}`, hint?.text), kept]);
  const echo = !!hint && echoesHint(heard.text, hint.words);
  console.log(`[voice] ${speechModels().asr} ${heard.latencyMs} ms, ${Math.round(file.size / 1024)} KB: ${JSON.stringify(heard.text)}${echo ? ' (the hint read back: dropped)' : ''}`);
  return { text: echo ? '' : heard.text, clip };
}

/** Render a batch's spoken messages. Same words for two people (owner and backup) are rendered once. */
export function speakBriefs(b: Batch) {
  if (!briefsEnabled()) return;
  const spoken = b.messages.filter((m) => m.delivery === 'spoken');
  const byText = new Map<string, Message[]>();
  for (const m of spoken) byText.set(m.body, [...(byText.get(m.body) ?? []), m]);
  for (const [text, messages] of byText) {
    void brief(text, messages).catch((e) => console.error(`[voice] brief for ${messages.map((m) => m.id).join(', ')} failed`, e));
  }
}

async function brief(text: string, messages: Message[]) {
  const t0 = Date.now();
  const audio = await speak(text);
  for (const m of messages) {
    const path = `${m.recipientId}/${m.id}.mp3`;
    const { error } = await db().storage.from('speech').upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
    if (error) throw error;
    await sql()`update message_deliveries set audio_path = ${path} where message_id = ${m.id} and recipient_id = ${m.recipientId}`;
  }
  console.log(`[voice] ${speechModels().tts} ${Date.now() - t0} ms for ${messages.length} brief(s): ${JSON.stringify(text.slice(0, 80))}`);
}

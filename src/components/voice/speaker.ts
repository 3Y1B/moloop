import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * The phone's one audio session: the pill records, spoken briefs play. They never overlap: holding the pill
 * cuts a brief off, and it plays again from the start once you let go, so nothing it said gets recorded.
 */

let mode: Promise<void> | undefined;

/** Record and play on the same session, out loud even with the ringer off. Once per app run. */
export function audioMode() {
  mode ??= setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch((e) => {
    mode = undefined;
    console.warn('[voice] audio mode', e);
  });
  return mode;
}

type Brief = { id: string; url: () => Promise<string> };

const played = new Set<string>();
let queue: Brief[] = [];
let current: { brief: Brief; player: AudioPlayer; timer: ReturnType<typeof setTimeout> } | null = null;
let talking = false;

/** Play a spoken message once, after whatever is already playing. */
export function speakOnce(brief: Brief) {
  if (played.has(brief.id)) return;
  played.add(brief.id);
  queue.push(brief);
  void next();
}

/** The pill is held: stop talking over them. */
export function holdStarted() {
  talking = true;
  if (!current) return;
  queue.unshift(current.brief);
  finish();
}

export function holdEnded() {
  talking = false;
  void next();
}

function finish() {
  if (!current) return;
  clearTimeout(current.timer);
  current.player.remove();
  current = null;
}

async function next() {
  if (current || talking || !queue.length) return;
  const brief = queue.shift()!;
  let uri: string;
  try {
    await audioMode();
    uri = await brief.url();
  } catch (e) {
    console.warn(`[voice] brief ${brief.id}`, e);
    return void next();
  }
  // Held the pill while the URL was on its way.
  if (talking || current) {
    queue.unshift(brief);
    return;
  }
  const player = createAudioPlayer({ uri });
  // A stalled download mustn't block every brief after it.
  const timer = setTimeout(done, 60_000);
  current = { brief, player, timer };
  function done() {
    if (current?.player !== player) return;
    finish();
    void next();
  }
  player.addListener('playbackStatusUpdate', (s) => {
    if (s.didJustFinish || s.error) done();
  });
  player.play();
}

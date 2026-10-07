import {
  getRecordingPermissionsAsync, RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useRepo } from '@/data/hooks';
import type { Heard } from '@/data/repo';
import { audioMode, holdEnded, holdStarted } from './speaker';

/** Speech, not music: mono AAC at 16 kHz is all the recogniser uses, and a 5 s hold is ~20 KB over 4G. */
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  web: { mimeType: 'audio/webm', bitsPerSecond: 32_000 },
};
const NAME = Platform.OS === 'web' ? 'clip.webm' : 'clip.m4a';

/** The recording as a Blob to upload: the browser records to a blob: URL, a phone to a file. */
const readClip = async (uri: string): Promise<Blob> => (Platform.OS === 'web' ? (await fetch(uri)).blob() : new File(uri));

/** Shorter than this is a tap, not a sentence. */
const MIN_MS = 400;
/** dBFS: quieter than this the whole hold is silence (the recogniser makes things up from silence). */
const SILENT_DB = -45;

/** 0 (silent) to 1 (loud), from the recorder's dBFS. */
const levelOf = (db: number | undefined) => (db == null ? 0 : Math.min(1, Math.max(0, (db + 50) / 40)));

export type HoldState = 'idle' | 'recording' | 'hearing';

/**
 * Hold to talk: `start` on press-in, `stop` on release. `stop` resolves with what was heard, or null if nothing was
 * (a tap, silence, or no microphone). Throws if the server couldn't transcribe it.
 * The first hold asks for the microphone; that hold is spent on the question, the next one records.
 */
export function useHoldToTalk() {
  const repo = useRepo();
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 80);
  const [state, setState] = useState<HoldState>('idle');
  const started = useRef<Promise<boolean> | null>(null);
  const peak = useRef(-160);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status.isRecording && status.metering != null && status.metering > peak.current) peak.current = status.metering;
  }, [status.isRecording, status.metering]);

  const start = () => {
    if (started.current) return;
    holdStarted();
    peak.current = -160;
    startedAt.current = Date.now();
    setState('recording');
    started.current = (async () => {
      const permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        if (permission.canAskAgain) await requestRecordingPermissionsAsync();
        return false;
      }
      await audioMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    })().catch((e) => {
      console.warn('[voice] recording failed to start', e);
      return false;
    });
  };

  const stop = async (): Promise<Heard | null> => {
    const recording = started.current;
    if (!recording) return null;
    try {
      if (!(await recording)) return null;
      const durationMs = Date.now() - startedAt.current;
      await recorder.stop();
      // Metering isn't on every platform; without it, trust the hold.
      const silent = status.metering !== undefined && peak.current < SILENT_DB;
      if (!recorder.uri || durationMs < MIN_MS || silent) return null;
      setState('hearing');
      const heard = await repo.transcribe({ audio: await readClip(recorder.uri), name: NAME, durationMs });
      return heard.text ? heard : null;
    } finally {
      // Briefs wait out the "Heard" moment too.
      holdEnded();
      started.current = null;
      setState('idle');
    }
  };

  return { state, level: state === 'recording' ? levelOf(status.metering) : 0, start, stop };
}

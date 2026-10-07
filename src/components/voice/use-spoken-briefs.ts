import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useRepo, useSnapshot } from '@/data/hooks';
import { speakOnce } from './speaker';

/** Older than this and it's news you'd rather read than hear (the app was closed when it came in). */
const FRESH_MS = 2 * 60_000;

/**
 * Spoken messages play out loud while the app is open: a new task when you're free, backup, next up. The text
 * arrives first and the audio follows a couple of seconds later, so this plays each one as its audio lands.
 * Busy volunteers get a ping instead, which is never spoken.
 */
export function useSpokenBriefs() {
  const repo = useRepo();
  const { messages, meId } = useSnapshot();

  useEffect(() => {
    const url = repo.speechUrl?.bind(repo);
    if (!url || !meId || AppState.currentState !== 'active') return;
    const now = Date.now();
    const due = messages
      .filter((m) => m.recipientId === meId && m.delivery === 'spoken' && m.audio && !m.read && now - m.at < FRESH_MS)
      .sort((a, b) => a.at - b.at);
    for (const m of due) speakOnce({ id: m.id, url: () => url(m.audio!) });
  }, [repo, messages, meId]);
}

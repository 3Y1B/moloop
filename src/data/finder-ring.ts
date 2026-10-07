import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from './supabase/client';

/*
 * "Turn yours on": opening the finder rings the other phone on the task, so they open theirs and the two phones can
 * hear each other. A Realtime broadcast on the task's own topic: nothing stored, no server. A phone that isn't
 * listening just misses it; the "You're close" prompt still comes from GPS.
 */

type Topic = { channel: RealtimeChannel; holders: number; rings: Set<() => void>; ready: boolean; owed: boolean };

/** Kept across Fast Refresh: both phones must use the same topic, so it can't be made unique per module run. */
const hot = globalThis as { __moloopFinderTopics?: Map<string, Topic> };
const topics = (hot.__moloopFinderTopics ??= new Map());

function send(topic: Topic) {
  void topic.channel.send({ type: 'broadcast', event: 'ring', payload: {} });
}

/** Keep the task's topic open while held. Returns the release. */
function hold(taskId: string): { topic: Topic; release: () => void } {
  let topic = topics.get(taskId);
  if (!topic) {
    const t: Topic = { channel: getSupabase().channel(`finder:${taskId}`), holders: 0, rings: new Set(), ready: false, owed: false };
    t.channel
      .on('broadcast', { event: 'ring' }, () => t.rings.forEach((ring) => ring()))
      .subscribe((status) => {
        t.ready = status === 'SUBSCRIBED';
        if (t.ready && t.owed) {
          t.owed = false;
          send(t);
        }
      });
    topics.set(taskId, t);
    topic = t;
  }
  const held = topic;
  held.holders++;
  let released = false;
  return {
    topic: held,
    release: () => {
      if (released) return;
      released = true;
      if (--held.holders > 0) return;
      topics.delete(taskId);
      void getSupabase().removeChannel(held.channel);
    },
  };
}

/** Call `onRing` whenever the other phone on `taskId` opens its finder. Returns the unsubscribe. */
export function listenForRing(taskId: string, onRing: () => void): () => void {
  const { topic, release } = hold(taskId);
  topic.rings.add(onRing);
  return () => {
    topic.rings.delete(onRing);
    release();
  };
}

/** Hold the topic open while the finder is up. `ring()` asks the other phone to open theirs; sent once joined. */
export function ringer(taskId: string): { ring: () => void; release: () => void } {
  const { topic, release } = hold(taskId);
  return {
    ring: () => (topic.ready ? send(topic) : (topic.owed = true)),
    release,
  };
}

// Which task's finder is on screen, so neither prompt shows over (or under) the finder it's asking you to open.
let open: string | null = null;
const watchers = new Set<() => void>();

export function setFinderOpen(taskId: string | null) {
  open = taskId;
  watchers.forEach((w) => w());
}

export const getFinderOpen = () => open;

export function subscribeFinderOpen(listener: () => void) {
  watchers.add(listener);
  return () => void watchers.delete(listener);
}

import type { Repo } from './repo';

/** A tapped push may arrive before realtime hydrates its message; wait briefly before marking it read. */
export function markPushRead(repo: Repo, messageId: string, waitMs = 15_000) {
  const has = () => repo.getSnapshot().messages.some((m) => m.id === messageId);
  const mark = () => repo.markRead([messageId]).catch((e) => console.warn('[push] markRead', e));
  if (has()) return void mark();
  const timer = setTimeout(() => unsubscribe(), waitMs);
  const unsubscribe = repo.subscribe(() => {
    if (!has()) return;
    clearTimeout(timer);
    unsubscribe();
    void mark();
  });
}

import type { Repo } from './repo';

export type { PushData } from './push';
export { markPushRead } from './push-message';
export const PUSH_CHANNELS = { tasks: 'tasks', updates: 'updates' } as const;

/** Web receives updates through realtime; native token registration must remain a no-op. */
export async function registerForPush(repo: Repo, options: { prompt: boolean }): Promise<void> {
  void repo;
  void options;
}

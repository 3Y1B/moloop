import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { MockRepo } from './mock/mock-repo';
import type { Repo, Snapshot } from './repo';

const RepoContext = createContext<Repo | null>(null);

/** Which backend the app runs on. Explicit: `.env.local` sets the Supabase URL either way. */
export const LIVE = process.env.EXPO_PUBLIC_REPO === 'supabase';

/** `EXPO_PUBLIC_REPO=supabase`: the shared world (sign-in, realtime, server commands). Anything else: the mock. */
function createRepo(): Repo {
  if (!LIVE) return new MockRepo();
  // Loaded only when live, so the mock never touches the Supabase client or expo-sqlite.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { SupabaseRepo } = require('./supabase-repo') as typeof import('./supabase-repo');
  const { getSupabase } = require('./supabase/client') as typeof import('./supabase/client');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const repo = new SupabaseRepo(getSupabase());
  // Back from the background: realtime may have dropped changes while the phone slept.
  if (Platform.OS !== 'web') AppState.addEventListener('change', (state) => state === 'active' && repo.resync());
  return repo;
}

export function RepoProvider({ children }: { children: ReactNode }) {
  const [repo] = useState(createRepo);
  return <RepoContext value={repo}>{children}</RepoContext>;
}

export function useRepo(): Repo {
  const repo = use(RepoContext);
  if (!repo) throw new Error('useRepo must be used inside <RepoProvider>');
  return repo;
}

export function useSnapshot(): Snapshot {
  const repo = useRepo();
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot);
}

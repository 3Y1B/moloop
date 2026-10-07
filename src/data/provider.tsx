import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { Repo, Snapshot } from './repo';
import { getSupabase } from './supabase/client';
import { SupabaseRepo } from './supabase-repo';

const RepoContext = createContext<Repo | null>(null);

/** The shared world: sign-in, realtime, server commands. */
function createRepo(): Repo {
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

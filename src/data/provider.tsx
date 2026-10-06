import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';

import { MockRepo } from './mock/mock-repo';
import type { Repo, Snapshot } from './repo';

const RepoContext = createContext<Repo | null>(null);

/** Swap point for Phase B: `new SupabaseRepo()` when EXPO_PUBLIC_SUPABASE_URL is set. */
function createRepo(): Repo {
  return new MockRepo();
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

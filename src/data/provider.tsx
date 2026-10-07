import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { Repo, Snapshot } from './repo';
import { getSupabase } from './supabase/client';
import { SupabaseRepo } from './supabase-repo';

const RepoContext = createContext<Repo | null>(null);

let repo: Repo | undefined;

/** The last module run's repo. Fast Refresh re-runs this module but keeps the Supabase client, so it's closed here. */
const hot = globalThis as { __moloopRepo?: { repo: SupabaseRepo; appState?: { remove(): void } } };

/**
 * The shared world: sign-in, realtime, server commands. One per app, created on first use. Not per
 * component: React runs a state initializer twice in development and drops one result, and a repo that
 * is dropped without dispose() keeps listening to the shared Supabase client.
 */
function getRepo(): Repo {
  if (repo) return repo;
  if (hot.__moloopRepo) {
    hot.__moloopRepo.appState?.remove();
    void hot.__moloopRepo.repo.dispose();
  }
  const created = new SupabaseRepo(getSupabase());
  // Back from the background: realtime may have dropped changes while the phone slept.
  const appState =
    Platform.OS !== 'web' ? AppState.addEventListener('change', (state) => state === 'active' && created.resync()) : undefined;
  hot.__moloopRepo = { repo: created, appState };
  repo = created;
  return created;
}

export function RepoProvider({ children }: { children: ReactNode }) {
  return <RepoContext value={getRepo()}>{children}</RepoContext>;
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

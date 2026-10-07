import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { Repo, Snapshot } from './repo';
import { getSupabase } from './supabase/client';
import { SupabaseRepo } from './supabase-repo';

const RepoContext = createContext<Repo | null>(null);

/** The shared world: sign-in, realtime, server commands. */
export function RepoProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<SupabaseRepo | null>(null);
  useEffect(() => {
    // Construct only after commit: StrictMode may discard a render without running its cleanup.
    const next = new SupabaseRepo(getSupabase());
    // Back from the background: realtime may have dropped changes while the phone slept.
    const foreground = Platform.OS !== 'web'
      ? AppState.addEventListener('change', (state) => { if (state === 'active') next.resync(); })
      : null;
    let mounted = true;
    // Publish after setup completes; a discarded StrictMode setup must never expose its disposed Repo.
    void Promise.resolve().then(() => { if (mounted) setRepo(next); });
    return () => {
      mounted = false;
      foreground?.remove();
      void next.dispose();
    };
  }, []);
  // Descendants use the Repo immediately; don't mount them with an empty context.
  if (!repo) return null;
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

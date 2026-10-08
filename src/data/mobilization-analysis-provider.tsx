import { createContext, use, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { MobilizationAnalysisStore } from './mobilization-analysis';
import { useRepo, useSnapshot } from './provider';

const AnalysisContext = createContext<MobilizationAnalysisStore | null>(null);

/** Lives beside the navigator, not inside the test screen, so route changes cannot stop a job. */
export function MobilizationAnalysisProvider({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const snapshot = useSnapshot();
  const me = snapshot.meId ? snapshot.volunteers[snapshot.meId] : undefined;
  const ownerId = me?.role === 'coordinator' ? snapshot.meId : null;
  const owned = useMemo(() => {
    const allowed = () => {
      const current = repo.getSnapshot();
      return !!ownerId && current.meId === ownerId && current.volunteers[ownerId]?.role === 'coordinator';
    };
    // Construction is pure. A discarded render cannot start a model or leave a timer/subscription.
    return { store: new MobilizationAnalysisStore(repo.mobilizations, { allowed }), allowed };
  }, [repo, ownerId]);
  useEffect(() => {
    const release = owned.store.retain();
    const unsubscribe = repo.subscribe(() => { if (ownerId && !owned.allowed()) owned.store.dispose(); });
    return () => {
      unsubscribe();
      // StrictMode immediately reattaches its effect. A microtask lease check distinguishes that
      // from a real provider unmount; either way, account loss is invalidated synchronously above.
      release();
    };
  }, [repo, ownerId, owned]);
  // Context changes immediately to the new owner's empty store, without remounting the navigator.
  return <AnalysisContext value={owned.store}>{children}</AnalysisContext>;
}

export function useMobilizationAnalyses() {
  const store = use(AnalysisContext);
  if (!store) throw new Error('useMobilizationAnalyses must be used inside <MobilizationAnalysisProvider>');
  const jobs = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    jobs, startAnalysis: store.startAnalysis, getAnalysis: store.getAnalysis,
    dismissAnalysis: store.dismissAnalysis, retryAnalysis: store.retryAnalysis,
  };
}

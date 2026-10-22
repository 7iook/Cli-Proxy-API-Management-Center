import { useAuthStore } from '@/stores/useAuthStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  hydrateQuotaMaps,
  mergeFreshQuota,
  pruneQuotaCache,
  readQuotaCache,
  writeQuotaCache,
} from '@/stores/quotaPersistence';

let installed = false;

/** Wire the quota store to localStorage, scoped to the connected management server. */
export function installQuotaPersistence(storage: Storage = window.localStorage): void {
  if (installed) return;
  installed = true;

  const scopeOf = () => {
    const { connectionStatus, apiBase } = useAuthStore.getState();
    return connectionStatus === 'connected' && apiBase ? apiBase : null;
  };

  const hydrate = () => {
    const scope = scopeOf();
    if (!scope) return;
    const maps = hydrateQuotaMaps(readQuotaCache(storage, scope), useQuotaStore.getState());
    if (Object.keys(maps).length)
      useQuotaStore.setState(maps as Partial<ReturnType<typeof useQuotaStore.getState>>);
  };

  useAuthStore.subscribe((state, prev) => {
    if (state.connectionStatus !== prev.connectionStatus || state.apiBase !== prev.apiBase)
      hydrate();
  });

  useQuotaStore.subscribe((state, prev) => {
    const scope = scopeOf();
    if (!scope) return;
    let snapshot = readQuotaCache(storage, scope);
    const initial = snapshot;
    if (state.fileGenerations !== prev.fileGenerations) {
      const changed = Object.keys(state.fileGenerations).filter(
        (name) => state.fileGenerations[name] !== prev.fileGenerations[name]
      );
      snapshot = pruneQuotaCache(snapshot, changed);
    }
    snapshot = mergeFreshQuota(snapshot, state);
    if (snapshot !== initial) writeQuotaCache(storage, scope, snapshot);
  });

  hydrate();
}

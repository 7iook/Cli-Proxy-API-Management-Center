import { useEffect } from 'react';
import { useAuthStore, usePanelPreferencesStore } from '@/stores';

/** Loads the server copy once connected and refetches when the window regains focus. */
export function usePanelPreferencesSync() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  useEffect(() => {
    if (connectionStatus === 'connected') void usePanelPreferencesStore.getState().load();
  }, [apiBase, connectionStatus]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        usePanelPreferencesStore.getState().refreshIfIdle();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
}

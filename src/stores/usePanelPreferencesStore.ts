/**
 * Panel display preferences, shared by everyone who manages this server and
 * cached per browser. Changes apply and persist locally at once; the server
 * copy is written after a short debounce with field-level last-writer-wins:
 * on a revision conflict the locally changed leaf paths are laid back over the
 * server document and the write is retried once.
 */

import { create } from 'zustand';
import { panelPreferencesApi, PreferencesConflictError } from '@/services/api/panelPreferences';
import {
  DEFAULT_PREFERENCES,
  diffPreferencePaths,
  getPreferenceAt,
  mergePreferences,
  normalizePreferences,
  reapplyPreferencePaths,
  type PanelPreferences,
  type PreferencesPatch,
} from '@/features/preferences/schema';
import {
  readLegacyPreferences,
  readPreferencesCache,
  writePreferencesCache,
} from '@/features/preferences/storage';

export type PreferencesSyncState = 'local-only' | 'syncing' | 'synced' | 'error';

export const PREFERENCES_FLUSH_DELAY_MS = 800;

interface PanelPreferencesState {
  prefs: PanelPreferences;
  syncState: PreferencesSyncState;
  update: (patch: PreferencesPatch) => void;
  /** Reads the server document and reconciles it with unsynced local changes. */
  load: () => Promise<void>;
  /** Window-focus refetch: skipped while local changes are pending. */
  refreshIfIdle: () => void;
  flush: () => Promise<void>;
  /** Forgets the server connection (logout / server change); local values stay. */
  reset: () => void;
}

// Sync bookkeeping that never drives rendering.
const cache = readPreferencesCache();
let dirty = new Set<string>(cache?.dirty ?? []);
let revision: string | null = null;
let supported: boolean | null = null;
let flushing = false;
let loadToken = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const clearFlushTimer = () => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
};

export const usePanelPreferencesStore = create<PanelPreferencesState>((set, get) => {
  const commit = (prefs: PanelPreferences) => {
    set({ prefs });
    writePreferencesCache({ prefs, dirty: [...dirty] });
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimeout(() => void get().flush(), PREFERENCES_FLUSH_DELAY_MS);
  };

  /** Server document wins; still-unsynced local paths are laid back on top of it. */
  const adoptServerDocument = (serverDoc: unknown) => {
    const server = normalizePreferences(serverDoc);
    const merged = reapplyPreferencePaths(server, get().prefs, dirty);
    const stillDifferent = new Set(diffPreferencePaths(server, merged));
    dirty = new Set([...dirty].filter((path) => stillDifferent.has(path)));
    commit(merged);
  };

  const markUnsupported = () => {
    supported = false;
    revision = null;
    dirty = new Set();
    set({ syncState: 'local-only' });
  };

  return {
    prefs: cache?.prefs ?? readLegacyPreferences(),
    syncState: 'local-only',

    update: (patch) => {
      const previous = get().prefs;
      const next = mergePreferences(previous, patch);
      const changed = diffPreferencePaths(previous, next);
      if (changed.length === 0) return;
      if (supported !== false) changed.forEach((path) => dirty.add(path));
      commit(next);
      if (supported === true) {
        set({ syncState: 'syncing' });
        scheduleFlush();
      }
    },

    load: async () => {
      if (flushing) return;
      const token = (loadToken += 1);
      set({ syncState: 'syncing' });
      let doc;
      try {
        doc = await panelPreferencesApi.get();
      } catch {
        if (token === loadToken) set({ syncState: 'error' });
        return;
      }
      if (token !== loadToken) return;
      if (doc === null) {
        markUnsupported();
        return;
      }
      supported = true;
      revision = doc.revision;
      if (doc.preferences === null) {
        // Nothing stored yet: publish whatever differs from the defaults.
        diffPreferencePaths(DEFAULT_PREFERENCES, get().prefs).forEach((path) => dirty.add(path));
      } else {
        adoptServerDocument(doc.preferences);
      }
      if (dirty.size > 0) {
        await get().flush();
      } else {
        set({ syncState: 'synced' });
      }
    },

    refreshIfIdle: () => {
      if (supported !== true || dirty.size > 0 || flushing || get().syncState === 'syncing') return;
      void get().load();
    },

    flush: async () => {
      clearFlushTimer();
      if (supported !== true || revision === null || dirty.size === 0 || flushing) return;
      const token = loadToken;
      flushing = true;
      set({ syncState: 'syncing' });
      let retried = false;
      try {
        for (;;) {
          const sent = get().prefs;
          const sentPaths = [...dirty];
          try {
            const doc = await panelPreferencesApi.put(sent, revision as string);
            if (token !== loadToken) return;
            revision = doc.revision;
            // Paths edited again while the request was in flight stay dirty.
            sentPaths.forEach((path) => {
              if (getPreferenceAt(get().prefs, path) === getPreferenceAt(sent, path)) {
                dirty.delete(path);
              }
            });
            commit(get().prefs);
            break;
          } catch (error: unknown) {
            if (token !== loadToken) return;
            if (error instanceof PreferencesConflictError && !retried) {
              retried = true;
              revision = error.document.revision;
              adoptServerDocument(error.document.preferences);
              if (dirty.size === 0) break;
              continue;
            }
            if (error instanceof PreferencesConflictError) {
              // Conflicted twice: keep local, adopt the new revision, retry on the next change.
              revision = error.document.revision;
            } else if ((error as { status?: number } | null)?.status === 404) {
              markUnsupported();
              return;
            }
            set({ syncState: 'error' });
            return;
          }
        }
      } finally {
        if (token === loadToken) flushing = false;
      }
      if (dirty.size > 0) {
        set({ syncState: 'syncing' });
        scheduleFlush();
      } else {
        set({ syncState: 'synced' });
      }
    },

    reset: () => {
      loadToken += 1;
      clearFlushTimer();
      flushing = false;
      revision = null;
      supported = null;
      dirty = new Set();
      commit(get().prefs);
      set({ syncState: 'local-only' });
    },
  };
});

/**
 * Browser storage for panel preferences: the per-browser cache of the synced
 * document plus the one-time read of the legacy per-page keys. Every access is
 * guarded; storage can be missing, blocked or full and the panel must still work.
 */

import {
  DEFAULT_PREFERENCES,
  migrateLegacyPreferences,
  normalizePreferences,
  type PanelPreferences,
} from './schema';

export const PREFERENCES_CACHE_KEY = 'cpamc.panelPreferences.v1';

const LEGACY_AUTH_FILES_UI_STATE_KEY = 'authFilesPage.uiState';
const LEGACY_AUTH_FILES_COMPACT_KEY = 'authFilesPage.compactMode';
const LEGACY_QUOTA_UI_STATE_KEY = 'quotaPage.uiState';

export interface PreferencesCache {
  prefs: PanelPreferences;
  /** Leaf paths changed locally and not yet confirmed by the server. */
  dirty: string[];
}

type StorageKind = 'localStorage' | 'sessionStorage';

const readJson = (kind: StorageKind, key: string): unknown => {
  try {
    const raw = globalThis.window?.[kind]?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
};

export function readPreferencesCache(): PreferencesCache | null {
  const raw = readJson('localStorage', PREFERENCES_CACHE_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const { prefs, dirty } = raw as { prefs?: unknown; dirty?: unknown };
  if (!prefs) return null;
  return {
    prefs: normalizePreferences(prefs),
    dirty: Array.isArray(dirty)
      ? dirty.filter((path): path is string => typeof path === 'string')
      : [],
  };
}

export function writePreferencesCache(cache: PreferencesCache) {
  try {
    globalThis.window?.localStorage?.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage unavailable or full: the in-memory copy still works.
  }
}

/** Legacy keys migrate once: only until the first cache write exists. */
export function readLegacyPreferences(): PanelPreferences {
  const authFilesUiState =
    readJson('localStorage', LEGACY_AUTH_FILES_UI_STATE_KEY) ??
    readJson('sessionStorage', LEGACY_AUTH_FILES_UI_STATE_KEY);
  const authFilesCompactMode = readJson('localStorage', LEGACY_AUTH_FILES_COMPACT_KEY);
  const quotaUiState = readJson('sessionStorage', LEGACY_QUOTA_UI_STATE_KEY);
  if (
    authFilesUiState === undefined &&
    authFilesCompactMode === undefined &&
    quotaUiState === undefined
  ) {
    return DEFAULT_PREFERENCES;
  }
  return migrateLegacyPreferences({ authFilesUiState, authFilesCompactMode, quotaUiState });
}

/**
 * Browser persistence for the last successfully fetched quota of each credential.
 *
 * Only rendered quota observations (the success-state objects held in useQuotaStore)
 * are stored, scoped per management server. Hydrated entries carry `cachedAt` so the
 * UI can label them; a fresh fetch replaces them, a failed fetch leaves storage alone.
 */

import { getQuotaCacheFileName } from '@/utils/quota/identity';

export const QUOTA_CACHE_FIELDS = [
  'antigravityQuota',
  'claudeQuota',
  'codexQuota',
  'devinQuota',
  'kimiQuota',
  'metaQuota',
  'pluginQuota',
  'xaiQuota',
] as const;

export type QuotaCacheField = (typeof QUOTA_CACHE_FIELDS)[number];

interface CachedEntry {
  cachedAt: number;
  state: Record<string, unknown>;
}

export type QuotaCacheSnapshot = Partial<Record<QuotaCacheField, Record<string, CachedEntry>>>;

const STORAGE_PREFIX = 'cpamc.quotaCache.v1:';
// Defensive: never persist anything that looks like a credential or a transient error.
const OMITTED_KEYS = new Set([
  'error',
  'errorStatus',
  'stale',
  'cachedAt',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'account',
]);

export const getQuotaCacheStorageKey = (scope: string): string =>
  `${STORAGE_PREFIX}${scope.trim().replace(/\/+$/, '').toLowerCase()}`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readQuotaCache(storage: StorageLike, scope: string): QuotaCacheSnapshot {
  try {
    const raw = storage.getItem(getQuotaCacheStorageKey(scope));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as QuotaCacheSnapshot) : {};
  } catch {
    return {};
  }
}

export function writeQuotaCache(
  storage: StorageLike,
  scope: string,
  snapshot: QuotaCacheSnapshot
): void {
  try {
    storage.setItem(getQuotaCacheStorageKey(scope), JSON.stringify(snapshot));
  } catch {
    // Quota exceeded / private mode: the cache is best effort.
  }
}

const sanitizeState = (state: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!OMITTED_KEYS.has(key)) result[key] = value;
  }
  return result;
};

const observedAtOf = (state: Record<string, unknown>, now: number): number => {
  const raw = state.observedAt ?? state.observedAtMs;
  const ms = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : now;
};

type QuotaMaps = Partial<Record<QuotaCacheField, Record<string, unknown>>>;

/** Fold freshly fetched success states into the snapshot; others leave it untouched. */
export function mergeFreshQuota(
  snapshot: QuotaCacheSnapshot,
  maps: QuotaMaps,
  now: number = Date.now()
): QuotaCacheSnapshot {
  let next = snapshot;
  for (const field of QUOTA_CACHE_FIELDS) {
    const map = maps[field];
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      const state = value as Record<string, unknown> | undefined;
      if (!state || state.status !== 'success' || state.cachedAt !== undefined) continue;
      if (next === snapshot) next = { ...snapshot };
      next[field] = {
        ...next[field],
        [key]: { cachedAt: observedAtOf(state, now), state: sanitizeState(state) },
      };
    }
  }
  return next;
}

/** Drop persisted entries belonging to the given auth file names (deleted/changed files). */
export function pruneQuotaCache(snapshot: QuotaCacheSnapshot, names: string[]): QuotaCacheSnapshot {
  if (names.length === 0) return snapshot;
  const drop = new Set(names);
  const next: QuotaCacheSnapshot = {};
  for (const field of QUOTA_CACHE_FIELDS) {
    const entries = snapshot[field];
    if (!entries) continue;
    next[field] = Object.fromEntries(
      Object.entries(entries).filter(([key]) => !drop.has(getQuotaCacheFileName(key)))
    );
  }
  return next;
}

/** Build hydrated store states (status success + cachedAt) for keys not already loaded. */
export function hydrateQuotaMaps(snapshot: QuotaCacheSnapshot, current: QuotaMaps): QuotaMaps {
  const result: QuotaMaps = {};
  for (const field of QUOTA_CACHE_FIELDS) {
    const entries = snapshot[field];
    if (!entries) continue;
    const existing = current[field] ?? {};
    const additions: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (existing[key] || !entry || typeof entry.state !== 'object') continue;
      additions[key] = { ...entry.state, status: 'success', cachedAt: entry.cachedAt };
    }
    if (Object.keys(additions).length) result[field] = { ...existing, ...additions };
  }
  return result;
}

const pad = (value: number) => String(value).padStart(2, '0');

export const formatQuotaCachedAt = (ms: number): string => {
  const date = new Date(ms);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

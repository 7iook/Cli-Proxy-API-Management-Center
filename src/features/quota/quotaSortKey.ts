/**
 * Quota sort keys: remaining 5-hour / weekly quota per credential.
 *
 * Pure functions over the per-provider quota states — no React, no store, no
 * clock of its own (`nowMs` is always passed in). Windows are classified by
 * their period length rather than their label, so every provider can be read
 * through the same two buckets.
 */

import type { QuotaProviderType } from './providers/types';

export type QuotaWindowKind = 'fiveHour' | 'weekly';

export type QuotaSortKey =
  | { status: 'value'; remaining: number; resetAtMs: number | null; reset: boolean }
  /** The provider supports quota but the state is not loaded, loading or failed. */
  | { status: 'missing' }
  /** Loaded successfully but has no window of that kind, or the file has no provider. */
  | { status: 'na' };

export type QuotaSortDirection = 'asc' | 'desc';

const FIVE_HOUR_RANGE: readonly [number, number] = [4, 6];
const WEEKLY_RANGE: readonly [number, number] = [144, 192];
const WEEK_HOURS = 7 * 24;

/** A provider window normalized to what sorting needs. */
interface Candidate {
  id?: string;
  /** Remaining percent, 0..100, before any reset adjustment. */
  remaining: number;
  resetAtMs: number | null;
  periodHours: number | null;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const kindOfPeriod = (periodHours: number | null | undefined): QuotaWindowKind | null => {
  if (!isFiniteNumber(periodHours)) return null;
  if (periodHours >= FIVE_HOUR_RANGE[0] && periodHours <= FIVE_HOUR_RANGE[1]) return 'fiveHour';
  if (periodHours >= WEEKLY_RANGE[0] && periodHours <= WEEKLY_RANGE[1]) return 'weekly';
  return null;
};

/** Account-level window ids that win over model-scoped windows of the same kind. */
const PREFERRED_IDS: Partial<Record<QuotaProviderType, Record<QuotaWindowKind, string>>> = {
  codex: { fiveHour: 'five-hour', weekly: 'weekly' },
  claude: { fiveHour: 'five-hour', weekly: 'seven-day' },
};

interface PercentUsedWindow {
  id?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

const fromUsedPercent = (windows: PercentUsedWindow[]): Candidate[] =>
  windows.flatMap((window) =>
    isFiniteNumber(window.usedPercent)
      ? [
          {
            id: window.id,
            remaining: clampPercent(100 - window.usedPercent),
            resetAtMs: isFiniteNumber(window.resetAtMs) ? window.resetAtMs : null,
            periodHours: window.periodHours ?? null,
          },
        ]
      : []
  );

const collectCandidates = (provider: QuotaProviderType, quota: object): Candidate[] => {
  switch (provider) {
    case 'claude':
    case 'codex':
      // Claude and Codex store percent USED.
      return fromUsedPercent((quota as { windows?: PercentUsedWindow[] }).windows ?? []);

    case 'devin': {
      const windows =
        (
          quota as {
            windows?: {
              id?: string;
              remainingPercent: number | null;
              resetAtMs: number | null;
              periodHours: number;
            }[];
          }
        ).windows ?? [];
      return windows.flatMap((window) =>
        isFiniteNumber(window.remainingPercent)
          ? [
              {
                id: window.id,
                remaining: clampPercent(window.remainingPercent),
                resetAtMs: isFiniteNumber(window.resetAtMs) ? window.resetAtMs : null,
                periodHours: window.periodHours,
              },
            ]
          : []
      );
    }

    case 'meta': {
      const windows =
        (
          quota as {
            data?: {
              windows?: {
                id?: string;
                usedPercent: number | null;
                resetAt?: number;
                durationMinutes?: number;
              }[];
            };
          }
        ).data?.windows ?? [];
      return windows.flatMap((window) => {
        if (!isFiniteNumber(window.usedPercent)) return [];
        // The upstream weekly bucket has no duration field; its scope defines seven days.
        const durationMinutes = window.id === 'weekly' ? WEEK_HOURS * 60 : window.durationMinutes;
        return [
          {
            id: window.id,
            remaining: clampPercent(100 - window.usedPercent),
            // Meta reports Unix seconds.
            resetAtMs: isFiniteNumber(window.resetAt) ? window.resetAt * 1000 : null,
            periodHours:
              isFiniteNumber(durationMinutes) && durationMinutes > 0 ? durationMinutes / 60 : null,
          },
        ];
      });
    }

    case 'xai': {
      const billing = (
        quota as {
          billing?: {
            periodType?: string;
            usagePercent?: number | null;
            resetAtMs?: number | null;
            periodHours?: number | null;
          } | null;
        }
      ).billing;
      // Only the weekly limit is a quota window; the monthly figure is a billing cycle.
      if (!billing || billing.periodType !== 'weekly' || !isFiniteNumber(billing.usagePercent)) {
        return [];
      }
      return [
        {
          remaining: clampPercent(100 - billing.usagePercent),
          resetAtMs: isFiniteNumber(billing.resetAtMs) ? billing.resetAtMs : null,
          periodHours: billing.periodHours ?? WEEK_HOURS,
        },
      ];
    }

    case 'antigravity':
    case 'plugin': {
      // Buckets live inside groups; the grouping is a display concern.
      const buckets = (
        (
          quota as {
            groups?: {
              buckets?: {
                id?: string;
                remainingFraction?: number | null;
                resetAtMs?: number | null;
                periodHours?: number | null;
              }[];
            }[];
          }
        ).groups ?? []
      ).flatMap((group) => group.buckets ?? []);
      return buckets.flatMap((bucket) =>
        isFiniteNumber(bucket.remainingFraction)
          ? [
              {
                id: bucket.id,
                // Antigravity reports the fraction REMAINING.
                remaining: clampPercent(bucket.remainingFraction * 100),
                resetAtMs: isFiniteNumber(bucket.resetAtMs) ? bucket.resetAtMs : null,
                periodHours: bucket.periodHours ?? null,
              },
            ]
          : []
      );
    }

    case 'kimi': {
      const rows =
        (
          quota as {
            rows?: {
              id?: string;
              used: number;
              limit: number;
              resetAtMs?: number | null;
              periodHours?: number | null;
            }[];
          }
        ).rows ?? [];
      return rows.flatMap((row) =>
        isFiniteNumber(row.limit) && row.limit > 0 && isFiniteNumber(row.used)
          ? [
              {
                id: row.id,
                remaining: clampPercent(((row.limit - row.used) / row.limit) * 100),
                resetAtMs: isFiniteNumber(row.resetAtMs) ? row.resetAtMs : null,
                periodHours: row.periodHours ?? null,
              },
            ]
          : []
      );
    }

    default:
      return [];
  }
};

/** A window whose reset instant has passed is full again. */
const toSortKey = (candidate: Candidate, nowMs: number): QuotaSortKey => {
  const reset = candidate.resetAtMs !== null && candidate.resetAtMs <= nowMs;
  return {
    status: 'value',
    remaining: reset ? 100 : candidate.remaining,
    resetAtMs: candidate.resetAtMs,
    reset,
  };
};

const compareValueKeys = (
  a: Extract<QuotaSortKey, { status: 'value' }>,
  b: Extract<QuotaSortKey, { status: 'value' }>
): number => {
  if (a.remaining !== b.remaining) return a.remaining - b.remaining;
  if (a.resetAtMs === b.resetAtMs) return 0;
  if (a.resetAtMs === null) return 1;
  if (b.resetAtMs === null) return -1;
  return a.resetAtMs - b.resetAtMs;
};

export function resolveQuotaSortKey(
  provider: QuotaProviderType | null,
  quota: unknown,
  kind: QuotaWindowKind,
  nowMs: number
): QuotaSortKey {
  if (provider === null) return { status: 'na' };
  if (!quota || typeof quota !== 'object') return { status: 'missing' };
  if ((quota as { status?: unknown }).status !== 'success') return { status: 'missing' };

  const candidates = collectCandidates(provider, quota).filter(
    (candidate) => kindOfPeriod(candidate.periodHours) === kind
  );
  if (candidates.length === 0) return { status: 'na' };

  const preferredId = PREFERRED_IDS[provider]?.[kind];
  const preferred =
    preferredId === undefined
      ? undefined
      : candidates.find((candidate) => candidate.id === preferredId);
  if (preferred) return toSortKey(preferred, nowMs);

  // No account-level window: the bottleneck (lowest effective remaining) decides.
  const keys = candidates.map(
    (candidate) => toSortKey(candidate, nowMs) as Extract<QuotaSortKey, { status: 'value' }>
  );
  return keys.reduce((best, key) => (compareValueKeys(key, best) < 0 ? key : best));
}

/**
 * Orders items by quota key. Values come first (by remaining, ties by earlier
 * reset), then `missing`, then `na` — those two stay at the bottom whatever the
 * direction. Stable; returns a new array.
 */
export function sortByQuotaKey<T>(
  items: readonly T[],
  getKey: (item: T) => QuotaSortKey,
  direction: QuotaSortDirection
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const rank = (key: QuotaSortKey) =>
    key.status === 'value' ? 0 : key.status === 'missing' ? 1 : 2;

  return items
    .map((item, index) => ({ item, index, key: getKey(item) }))
    .sort((a, b) => {
      const rankDiff = rank(a.key) - rank(b.key);
      if (rankDiff !== 0) return rankDiff;
      if (a.key.status === 'value' && b.key.status === 'value') {
        if (a.key.remaining !== b.key.remaining) {
          return sign * (a.key.remaining - b.key.remaining);
        }
        // Ties: earlier reset first, regardless of direction.
        const resetDiff = compareValueKeys(a.key, b.key);
        if (resetDiff !== 0) return resetDiff;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

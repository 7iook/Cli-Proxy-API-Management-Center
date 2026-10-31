/**
 * Passive Claude quota snapshots.
 *
 * CPA records the `anthropic-ratelimit-unified-*` headers of real proxied requests
 * and returns them on each credential as `quota_snapshot`. Rendering it costs no
 * upstream request, so it is shown as soon as the credential list loads.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, ClaudeQuotaState, ClaudeUsagePayload } from '@/types';
import { buildClaudeQuotaWindows } from './data';

export interface PassiveQuotaWindow {
  utilization: number | null;
  resetsAt: string | null;
}

export interface PassiveQuotaSnapshot {
  capturedAtMs: number;
  source: string;
  windows: Record<string, PassiveQuotaWindow>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readInstant = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};

/** Parse the backend `quota_snapshot` field; null when absent or unusable. */
export function readPassiveQuotaSnapshot(file: AuthFileItem): PassiveQuotaSnapshot | null {
  const raw =
    (file as Record<string, unknown>)['quota_snapshot'] ??
    (file as Record<string, unknown>)['quotaSnapshot'];
  if (!isRecord(raw)) return null;
  const capturedAt = readInstant(raw['captured_at'] ?? raw['capturedAt']);
  if (!capturedAt || !isRecord(raw.windows)) return null;
  const windows: Record<string, PassiveQuotaWindow> = {};
  for (const [key, value] of Object.entries(raw.windows)) {
    if (!isRecord(value)) continue;
    const utilization = readNumber(value.utilization);
    const resetsAt = readInstant(value['resets_at'] ?? value['resetsAt']);
    if (utilization === null && resetsAt === null) continue;
    windows[key] = { utilization, resetsAt };
  }
  if (Object.keys(windows).length === 0) return null;
  return {
    capturedAtMs: Date.parse(capturedAt),
    source: typeof raw.source === 'string' ? raw.source : 'passive',
    windows,
  };
}

/**
 * Turn a passive snapshot into the same success state a manual refresh produces.
 * A window whose reset instant has already passed is shown as reset (0%).
 */
export function buildPassiveClaudeQuotaState(
  snapshot: PassiveQuotaSnapshot,
  t: TFunction,
  nowMs: number = Date.now()
): ClaudeQuotaState {
  const payload: ClaudeUsagePayload = {};
  for (const [key, window] of Object.entries(snapshot.windows)) {
    const resetMs = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
    const hasReset = Number.isFinite(resetMs) && resetMs <= nowMs;
    payload[key] = hasReset
      ? { utilization: 0, resets_at: null }
      : { utilization: window.utilization, resets_at: window.resetsAt };
  }
  return {
    status: 'success',
    windows: buildClaudeQuotaWindows(payload, t),
    observedAt: new Date(snapshot.capturedAtMs).toISOString(),
    stale: false,
    passiveAt: snapshot.capturedAtMs,
  };
}

/**
 * Whether a passive snapshot captured at `capturedAtMs` should replace the
 * current store entry. Results produced in this page session (manual refresh,
 * including loading and failures) always win; browser-cached and earlier
 * passive entries lose to a newer capture.
 */
export function shouldApplyPassiveQuota(
  current: ClaudeQuotaState | undefined,
  capturedAtMs: number
): boolean {
  if (!current || current.status === 'idle') return true;
  if (typeof current.passiveAt === 'number') return capturedAtMs > current.passiveAt;
  if (current.status === 'success' && typeof current.cachedAt === 'number')
    return capturedAtMs >= current.cachedAt;
  return false;
}

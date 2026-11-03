/**
 * API boundary for the manually maintained Claude `subscription` auth-file field.
 * Reads the backend snake_case shape and defines the PATCH wire value.
 */

import type {
  AuthFileSubscription,
  AuthFileSubscriptionCycle,
  AuthFileSubscriptionState,
} from '@/types/authFile';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `YYYY-MM-DD` when it names a real calendar day, otherwise null. */
export const normalizeSubscriptionDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return match[0];
};

export const normalizeSubscriptionCycle = (value: unknown): AuthFileSubscriptionCycle =>
  typeof value === 'string' && ['annual', 'yearly', 'year'].includes(value.trim().toLowerCase())
    ? 'annual'
    : 'monthly';

const normalizeState = (value: unknown): AuthFileSubscriptionState | undefined => {
  if (typeof value !== 'string') return undefined;
  const state = value.trim().toLowerCase();
  return state === 'active' || state === 'warning' || state === 'expired' || state === 'unset'
    ? state
    : undefined;
};

/**
 * Normalize the backend `subscription` object (snake_case) into the camelCase shape.
 * Returns undefined when the value is absent or carries nothing usable.
 */
export const readAuthFileSubscription = (value: unknown): AuthFileSubscription | undefined => {
  if (!isRecord(value)) return undefined;
  const start = normalizeSubscriptionDate(value.start) ?? undefined;
  const end = normalizeSubscriptionDate(value.end);
  const autoRaw = value.auto_renew ?? value.autoRenew;
  const daysRaw = value.days_left ?? value.daysLeft;
  const periodStart =
    normalizeSubscriptionDate(value.period_start ?? value.periodStart) ?? undefined;
  const periodEnd = normalizeSubscriptionDate(value.period_end ?? value.periodEnd) ?? undefined;
  const daysLeft =
    typeof daysRaw === 'number' && Number.isFinite(daysRaw) ? Math.trunc(daysRaw) : undefined;
  const state = normalizeState(value.state);
  if (!start && !end && !state) return undefined;
  return {
    ...(start ? { start } : {}),
    cycle: normalizeSubscriptionCycle(value.cycle),
    autoRenew: autoRaw === true,
    end,
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
    ...(daysLeft !== undefined ? { daysLeft } : {}),
    ...(state ? { state } : {}),
  };
};

/** Wire shape for PATCH credentials/fields `subscription` (null deletes it). */
export type SubscriptionPatchValue = {
  start: string;
  cycle: AuthFileSubscriptionCycle;
  auto_renew: boolean;
  end: string | null;
};

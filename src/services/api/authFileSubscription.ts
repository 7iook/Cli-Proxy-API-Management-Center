/**
 * API boundary for the manually maintained Claude `subscription` auth-file field.
 * Reads the backend snake_case shape and defines the PATCH wire value.
 */

import type {
  AuthFileSubscription,
  AuthFileSubscriptionCycle,
  AuthFileSubscriptionState,
} from '@/types/authFile';

/** `YYYY-MM-DD`, optionally followed by ` HH:mm` or `THH:mm` (Asia/Shanghai wall clock). */
const VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Canonical subscription value, or null when invalid:
 * `YYYY-MM-DD` stays date-only (00:00), `YYYY-MM-DD HH:mm` / `YYYY-MM-DDTHH:mm`
 * becomes `YYYY-MM-DD HH:mm` (minute precision, Asia/Shanghai).
 */
export const normalizeSubscriptionDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = VALUE_RE.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (match[4] === undefined) return date;
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  if (hh > 23 || mm > 59) return null;
  return `${date} ${match[4]}:${match[5]}`;
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
  const secondsRaw = value.seconds_left ?? value.secondsLeft;
  const secondsLeft =
    typeof secondsRaw === 'number' && Number.isFinite(secondsRaw)
      ? Math.trunc(secondsRaw)
      : undefined;
  const expiresRaw = value.expires_at ?? value.expiresAt;
  const expiresAt =
    typeof expiresRaw === 'string' && Number.isFinite(Date.parse(expiresRaw))
      ? expiresRaw
      : undefined;
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
    ...(secondsLeft !== undefined ? { secondsLeft } : {}),
    ...(expiresAt ? { expiresAt } : {}),
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

/**
 * Claude subscription expiry: pure helpers shared by the card badge, the editor
 * preview, sorting and filtering.
 *
 * The backend (CLIProxyAPI) is the source of truth and returns computed fields
 * (period_start / period_end / days_left / state). The local calculation mirrors
 * its rules so the editor can preview unsaved input and older servers still work:
 * - Calendar dates are evaluated in Asia/Shanghai (Beijing time).
 * - Billing anchors on the start day: start + k months (or years), clamped to
 *   the last day of shorter months, always counted from the original anchor.
 * - auto_renew defaults to false: only the first period counts.
 * - A manual `end` overrides the computed period end.
 */

import type {
  AuthFileItem,
  AuthFileSubscription,
  AuthFileSubscriptionCycle,
  AuthFileSubscriptionState,
} from '@/types';
import {
  normalizeSubscriptionCycle,
  normalizeSubscriptionDate,
  readAuthFileSubscription,
  type SubscriptionPatchValue,
} from '@/services/api/authFileSubscription';

export { normalizeSubscriptionDate, readAuthFileSubscription, type SubscriptionPatchValue };

export const SUBSCRIPTION_TIME_ZONE = 'Asia/Shanghai';
/** Days left (inclusive) at or below which a subscription is shown as expiring. */
export const SUBSCRIPTION_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NOTE_DATE_RE = /(?:订阅)?(\d{4})-(\d{1,2})-(\d{1,2})/;

type CivilDate = { y: number; m: number; d: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pad2 = (value: number): string => String(value).padStart(2, '0');

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const toCivil = (y: number, m: number, d: number): CivilDate | null => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1970 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return { y, m, d };
};

const parseCivil = (value: unknown): CivilDate | null => {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  return toCivil(Number(match[1]), Number(match[2]), Number(match[3]));
};

const formatCivil = (date: CivilDate): string => `${date.y}-${pad2(date.m)}-${pad2(date.d)}`;

const dayNumber = (date: CivilDate): number => Date.UTC(date.y, date.m - 1, date.d) / DAY_MS;

/** Today's calendar date in Beijing time. */
export const subscriptionToday = (nowMs: number = Date.now()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SUBSCRIPTION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

/** Anchor + months, clamped to the target month's last day. */
export const addSubscriptionMonths = (anchor: string, months: number): string | null => {
  const civil = parseCivil(anchor);
  if (!civil) return null;
  const index = civil.y * 12 + (civil.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return formatCivil({ y, m, d: Math.min(civil.d, daysInMonth(y, m)) });
};

/** Signed day difference `to - from`; null when either date is invalid. */
export const diffSubscriptionDays = (from: string, to: string): number | null => {
  const a = parseCivil(from);
  const b = parseCivil(to);
  if (!a || !b) return null;
  return Math.round(dayNumber(b) - dayNumber(a));
};

export type SubscriptionInput = {
  start?: string | null;
  cycle?: AuthFileSubscriptionCycle;
  autoRenew?: boolean;
  end?: string | null;
};

export type SubscriptionPeriod = {
  state: AuthFileSubscriptionState;
  start?: string;
  cycle: AuthFileSubscriptionCycle;
  autoRenew: boolean;
  end?: string | null;
  periodStart?: string;
  periodEnd?: string;
  daysLeft?: number;
};

export const stateForDaysLeft = (daysLeft: number): AuthFileSubscriptionState => {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= SUBSCRIPTION_WARNING_DAYS) return 'warning';
  return 'active';
};

/** Local period calculation; mirrors the backend rules (see file header). */
export const computeSubscriptionPeriod = (
  input: SubscriptionInput | null | undefined,
  today: string = subscriptionToday()
): SubscriptionPeriod => {
  const cycle = input?.cycle === 'annual' ? 'annual' : 'monthly';
  const autoRenew = input?.autoRenew === true;
  const start = normalizeSubscriptionDate(input?.start);
  const end = normalizeSubscriptionDate(input?.end);
  const todayDate = normalizeSubscriptionDate(today);
  if (!start || !todayDate) {
    return { state: 'unset', cycle, autoRenew, end };
  }
  const step = cycle === 'annual' ? 12 : 1;

  let k = 0;
  if (autoRenew) {
    // Latest anchor not after the reference day (today, or the manual end when earlier).
    const reference = end && end < todayDate ? end : todayDate;
    const startCivil = parseCivil(start) as CivilDate;
    const refCivil = parseCivil(reference) as CivilDate;
    const monthsBetween = (refCivil.y - startCivil.y) * 12 + (refCivil.m - startCivil.m);
    k = Math.max(0, Math.floor(monthsBetween / step));
    while (k > 0 && (addSubscriptionMonths(start, k * step) as string) > reference) k -= 1;
    while ((addSubscriptionMonths(start, (k + 1) * step) as string) <= reference) k += 1;
  }

  const periodStart = addSubscriptionMonths(start, k * step) as string;
  const computedEnd = addSubscriptionMonths(start, (k + 1) * step) as string;
  const periodEnd = end ?? computedEnd;
  const daysLeft = diffSubscriptionDays(todayDate, periodEnd) as number;
  return {
    state: stateForDaysLeft(daysLeft),
    start,
    cycle,
    autoRenew,
    end,
    periodStart: periodStart <= periodEnd ? periodStart : start,
    periodEnd,
    daysLeft,
  };
};

/**
 * Effective period for display: backend computed fields win when present,
 * otherwise the local calculation fills in.
 */
export const resolveSubscriptionPeriod = (
  subscription: AuthFileSubscription | null | undefined,
  today: string = subscriptionToday()
): SubscriptionPeriod => {
  if (!subscription) return computeSubscriptionPeriod(null, today);
  const local = computeSubscriptionPeriod(subscription, today);
  if (subscription.state === 'unset') {
    return { ...local, state: 'unset', periodStart: undefined, periodEnd: undefined };
  }
  if (subscription.state && subscription.periodEnd && subscription.daysLeft !== undefined) {
    return {
      ...local,
      state: subscription.state,
      periodStart: subscription.periodStart ?? local.periodStart,
      periodEnd: subscription.periodEnd,
      daysLeft: subscription.daysLeft,
    };
  }
  return local;
};

export const isClaudeAuthFile = (file: Pick<AuthFileItem, 'type' | 'provider'>): boolean =>
  String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase() === 'claude';

/** Claude files whose subscription is expiring soon (≤7 days) or already expired. */
export const isSubscriptionExpiring = (
  file: AuthFileItem,
  today: string = subscriptionToday()
): boolean => {
  if (!isClaudeAuthFile(file)) return false;
  const { state } = resolveSubscriptionPeriod(file.subscription, today);
  return state === 'warning' || state === 'expired';
};

/** Sort key: days left (expired first, soonest next); null = no subscription (sorted last). */
export const subscriptionSortKey = (
  file: AuthFileItem,
  today: string = subscriptionToday()
): number | null => {
  if (!isClaudeAuthFile(file)) return null;
  const period = resolveSubscriptionPeriod(file.subscription, today);
  return period.state === 'unset' || period.daysLeft === undefined ? null : period.daysLeft;
};

/** Stable sort by expiry: soonest first, unset/non-Claude last, ties keep input order. */
export const sortBySubscriptionExpiry = <T extends AuthFileItem>(
  files: T[],
  today: string = subscriptionToday()
): T[] =>
  files
    .map((file, index) => ({ file, index, key: subscriptionSortKey(file, today) }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return a.key - b.key || a.index - b.index;
    })
    .map((entry) => entry.file);

/** Extract a subscription date such as `订阅2026-10-18` or `2026-1-5` from a note. */
export const parseSubscriptionDateFromNote = (note: unknown): string | null => {
  if (typeof note !== 'string') return null;
  const match = NOTE_DATE_RE.exec(note);
  if (!match) return null;
  const civil = toCivil(Number(match[1]), Number(match[2]), Number(match[3]));
  return civil ? formatCivil(civil) : null;
};

export type SubscriptionBadgeTier = 'active' | 'warning' | 'today' | 'expired' | 'unset';

export type SubscriptionBadge = {
  tier: SubscriptionBadgeTier;
  /** CSS tone: today shares the warning colour. */
  tone: AuthFileSubscriptionState;
  labelKey: string;
  labelParams: Record<string, string | number>;
  tooltipKey: string | null;
  tooltipParams: Record<string, string | number>;
};

/** `MM-DD` for compact badge text. */
export const formatSubscriptionShortDate = (value: string | undefined): string =>
  value && DATE_RE.test(value) ? value.slice(5) : '';

export const describeSubscriptionBadge = (period: SubscriptionPeriod): SubscriptionBadge => {
  const tooltipParams = {
    start: period.start ?? '',
    from: formatSubscriptionShortDate(period.periodStart),
    to: formatSubscriptionShortDate(period.periodEnd),
  };
  const tooltipKey =
    period.state === 'unset' || !period.periodEnd
      ? null
      : period.autoRenew
        ? 'auth_files.subscription_tooltip_auto'
        : 'auth_files.subscription_tooltip';
  const date = formatSubscriptionShortDate(period.periodEnd);
  const days = period.daysLeft ?? 0;

  if (period.state === 'unset' || period.daysLeft === undefined) {
    return {
      tier: 'unset',
      tone: 'unset',
      labelKey: 'auth_files.subscription_badge_unset',
      labelParams: {},
      tooltipKey: null,
      tooltipParams,
    };
  }
  if (days < 0 || period.state === 'expired') {
    return {
      tier: 'expired',
      tone: 'expired',
      labelKey: 'auth_files.subscription_badge_expired',
      labelParams: { days: Math.abs(days), date },
      tooltipKey,
      tooltipParams,
    };
  }
  if (days === 0) {
    return {
      tier: 'today',
      tone: 'warning',
      labelKey: 'auth_files.subscription_badge_today',
      labelParams: { date },
      tooltipKey,
      tooltipParams,
    };
  }
  if (days <= SUBSCRIPTION_WARNING_DAYS || period.state === 'warning') {
    return {
      tier: 'warning',
      tone: 'warning',
      labelKey: 'auth_files.subscription_badge_warning',
      labelParams: { days, date },
      tooltipKey,
      tooltipParams,
    };
  }
  return {
    tier: 'active',
    tone: 'active',
    labelKey: 'auth_files.subscription_badge_active',
    labelParams: { days, date },
    tooltipKey,
    tooltipParams,
  };
};

/** Read the stored (raw file JSON) subscription into the wire shape; null when absent. */
export const readStoredSubscription = (value: unknown): SubscriptionPatchValue | null => {
  if (!isRecord(value)) return null;
  const start = normalizeSubscriptionDate(value.start);
  if (!start) return null;
  return {
    start,
    cycle: normalizeSubscriptionCycle(value.cycle),
    auto_renew: (value.auto_renew ?? value.autoRenew) === true,
    end: normalizeSubscriptionDate(value.end),
  };
};

export type SubscriptionDraftError =
  | 'auth_files.subscription_invalid_start'
  | 'auth_files.subscription_invalid_end'
  | 'auth_files.subscription_end_before_start'
  | 'auth_files.subscription_start_required';

export type SubscriptionDraft = {
  start: string;
  cycle: AuthFileSubscriptionCycle;
  autoRenew: boolean;
  end: string;
};

export const validateSubscriptionDraft = (
  draft: SubscriptionDraft
): SubscriptionDraftError | null => {
  const startText = draft.start.trim();
  const endText = draft.end.trim();
  if (!startText) return endText ? 'auth_files.subscription_start_required' : null;
  const start = normalizeSubscriptionDate(startText);
  if (!start) return 'auth_files.subscription_invalid_start';
  if (!endText) return null;
  const end = normalizeSubscriptionDate(endText);
  if (!end) return 'auth_files.subscription_invalid_end';
  if (end < start) return 'auth_files.subscription_end_before_start';
  return null;
};

/** Draft → wire value; null means "delete the subscription". Throws nothing; validate first. */
export const subscriptionDraftToPatch = (
  draft: SubscriptionDraft
): SubscriptionPatchValue | null => {
  const start = normalizeSubscriptionDate(draft.start.trim());
  if (!start) return null;
  return {
    start,
    cycle: draft.cycle === 'annual' ? 'annual' : 'monthly',
    auto_renew: draft.autoRenew,
    end: normalizeSubscriptionDate(draft.end.trim()),
  };
};

export const sameSubscription = (
  a: SubscriptionPatchValue | null,
  b: SubscriptionPatchValue | null
): boolean => {
  if (!a || !b) return a === b;
  return (
    a.start === b.start && a.cycle === b.cycle && a.auto_renew === b.auto_renew && a.end === b.end
  );
};

/**
 * Claude subscription expiry: pure helpers shared by the card badge, the editor
 * preview, sorting and filtering.
 *
 * The backend (CLIProxyAPI) is the source of truth and returns computed fields
 * (period_start / period_end / expires_at / seconds_left / days_left / state). The local
 * calculation mirrors its rules so the editor can preview unsaved input and older
 * servers still work:
 * - Values are Asia/Shanghai (Beijing) wall-clock with minute precision:
 *   `YYYY-MM-DD` means 00:00, `YYYY-MM-DD HH:mm` is exact.
 * - Billing anchors on the start: start + k months (or years), clamped to the last day
 *   of shorter months, keeping the time of day, always counted from the original anchor.
 * - auto_renew defaults to false: only the first period counts.
 * - A manual `end` overrides the computed period end.
 * - Expired once now >= expiry; warning when at most 7 days are left.
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

const HOUR_MS = 3_600_000;
const CST_OFFSET_MS = 8 * HOUR_MS;
const NOTE_DATE_RE = /(?:订阅)?(\d{4})-(\d{1,2})-(\d{1,2})/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

type CivilDateTime = { y: number; m: number; d: number; hh: number; mm: number; hasTime: boolean };

/** Reference time: epoch ms, or a Beijing wall-clock value (`YYYY-MM-DD` = 00:00). */
export type SubscriptionNow = number | string;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pad2 = (value: number): string => String(value).padStart(2, '0');

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const parseCivil = (value: unknown): CivilDateTime | null => {
  const canonical = normalizeSubscriptionDate(value);
  if (!canonical) return null;
  return {
    y: Number(canonical.slice(0, 4)),
    m: Number(canonical.slice(5, 7)),
    d: Number(canonical.slice(8, 10)),
    hh: canonical.length > 10 ? Number(canonical.slice(11, 13)) : 0,
    mm: canonical.length > 10 ? Number(canonical.slice(14, 16)) : 0,
    hasTime: canonical.length > 10,
  };
};

const civilToMs = (c: CivilDateTime): number =>
  Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mm) - CST_OFFSET_MS;

const formatCivil = (c: CivilDateTime, withTime: boolean): string => {
  const date = `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;
  return withTime ? `${date} ${pad2(c.hh)}:${pad2(c.mm)}` : date;
};

/** Epoch ms of a subscription value (Beijing time); null when invalid. */
export const parseSubscriptionInstant = (value: unknown): number | null => {
  const civil = parseCivil(value);
  return civil ? civilToMs(civil) : null;
};

/** Epoch ms → `YYYY-MM-DD HH:mm` in Beijing time. */
export const formatSubscriptionInstant = (ms: number): string => {
  const shifted = new Date(ms + CST_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} ` +
    `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`
  );
};

const resolveNowMs = (now: SubscriptionNow | undefined): number => {
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'string') {
    const parsed = parseSubscriptionInstant(now);
    if (parsed !== null) return parsed;
  }
  return Date.now();
};

/** Today's calendar date in Beijing time. */
export const subscriptionToday = (nowMs: number = Date.now()): string =>
  formatSubscriptionInstant(nowMs).slice(0, 10);

const addMonthsCivil = (anchor: CivilDateTime, months: number): CivilDateTime => {
  const index = anchor.y * 12 + (anchor.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { ...anchor, y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
};

/**
 * Anchor + months, clamped to the target month's last day, keeping the time of day.
 * Output keeps the input form (date-only stays date-only).
 */
export const addSubscriptionMonths = (anchor: string, months: number): string | null => {
  const civil = parseCivil(anchor);
  if (!civil) return null;
  return formatCivil(addMonthsCivil(civil, months), civil.hasTime);
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
  /** `YYYY-MM-DD HH:mm`, Beijing time. */
  periodStart?: string;
  periodEnd?: string;
  /** Expiry instant (epoch ms). */
  expiresAtMs?: number;
  /** Seconds until expiry (<= 0 once expired). */
  secondsLeft?: number;
  /** floor(secondsLeft / 1 day). */
  daysLeft?: number;
};

export const stateForSecondsLeft = (secondsLeft: number): AuthFileSubscriptionState => {
  if (secondsLeft <= 0) return 'expired';
  if (secondsLeft <= SUBSCRIPTION_WARNING_DAYS * 86_400) return 'warning';
  return 'active';
};

const remainingFields = (expiresAtMs: number, nowMs: number) => {
  const secondsLeft = Math.floor((expiresAtMs - nowMs) / 1000);
  return {
    expiresAtMs,
    secondsLeft,
    daysLeft: Math.floor(secondsLeft / 86_400),
    state: stateForSecondsLeft(secondsLeft),
  };
};

/** Local period calculation; mirrors the backend rules (see file header). */
export const computeSubscriptionPeriod = (
  input: SubscriptionInput | null | undefined,
  now?: SubscriptionNow
): SubscriptionPeriod => {
  const cycle = input?.cycle === 'annual' ? 'annual' : 'monthly';
  const autoRenew = input?.autoRenew === true;
  const start = normalizeSubscriptionDate(input?.start);
  const end = normalizeSubscriptionDate(input?.end);
  const startCivil = parseCivil(start);
  if (!start || !startCivil) {
    return { state: 'unset', cycle, autoRenew, end };
  }
  const nowMs = resolveNowMs(now);
  const step = cycle === 'annual' ? 12 : 1;
  const anchorMs = (k: number) => civilToMs(addMonthsCivil(startCivil, k * step));

  let periodStartMs: number;
  let periodEndMs: number;
  const endMs = end ? parseSubscriptionInstant(end) : null;
  if (endMs !== null) {
    // Period start: latest anchor occurrence strictly before the manual end.
    let k = 0;
    while (k < 6000 && anchorMs(k + 1) < endMs) k += 1;
    periodStartMs = anchorMs(k);
    periodEndMs = endMs;
  } else if (!autoRenew) {
    periodStartMs = anchorMs(0);
    periodEndMs = anchorMs(1);
  } else {
    const shifted = new Date(nowMs + CST_OFFSET_MS);
    const monthsBetween =
      (shifted.getUTCFullYear() - startCivil.y) * 12 + (shifted.getUTCMonth() + 1 - startCivil.m);
    let k = Math.max(0, Math.floor(monthsBetween / step));
    while (k > 0 && anchorMs(k) > nowMs) k -= 1;
    while (anchorMs(k + 1) <= nowMs) k += 1;
    periodStartMs = anchorMs(k);
    periodEndMs = anchorMs(k + 1);
  }

  return {
    start,
    cycle,
    autoRenew,
    end,
    periodStart: formatSubscriptionInstant(periodStartMs),
    periodEnd: formatSubscriptionInstant(periodEndMs),
    ...remainingFields(periodEndMs, nowMs),
  };
};

/**
 * Effective period for display: the backend expiry wins when present (remaining time is
 * recomputed against now), otherwise the local calculation fills in.
 */
export const resolveSubscriptionPeriod = (
  subscription: AuthFileSubscription | null | undefined,
  now?: SubscriptionNow
): SubscriptionPeriod => {
  if (!subscription) return computeSubscriptionPeriod(null, now);
  const local = computeSubscriptionPeriod(subscription, now);
  if (subscription.state === 'unset') {
    return {
      state: 'unset',
      start: local.start,
      cycle: local.cycle,
      autoRenew: local.autoRenew,
      end: local.end,
    };
  }
  const serverExpiry = subscription.expiresAt
    ? Date.parse(subscription.expiresAt)
    : parseSubscriptionInstant(subscription.periodEnd);
  if (serverExpiry !== null && Number.isFinite(serverExpiry)) {
    const periodStartMs = parseSubscriptionInstant(subscription.periodStart);
    return {
      ...local,
      periodStart:
        periodStartMs !== null ? formatSubscriptionInstant(periodStartMs) : local.periodStart,
      periodEnd: formatSubscriptionInstant(serverExpiry),
      ...remainingFields(serverExpiry, resolveNowMs(now)),
    };
  }
  return local;
};

export const isClaudeAuthFile = (file: Pick<AuthFileItem, 'type' | 'provider'>): boolean =>
  String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase() === 'claude';

/** Claude files whose subscription is expiring soon (≤7 days) or already expired. */
export const isSubscriptionExpiring = (file: AuthFileItem, now?: SubscriptionNow): boolean => {
  if (!isClaudeAuthFile(file)) return false;
  const { state } = resolveSubscriptionPeriod(file.subscription, now);
  return state === 'warning' || state === 'expired';
};

/** Sort key: expiry timestamp (expired first, soonest next); null = no subscription (last). */
export const subscriptionSortKey = (file: AuthFileItem, now?: SubscriptionNow): number | null => {
  if (!isClaudeAuthFile(file)) return null;
  const period = resolveSubscriptionPeriod(file.subscription, now);
  return period.state === 'unset' || period.expiresAtMs === undefined ? null : period.expiresAtMs;
};

/** Stable sort by expiry: soonest first, unset/non-Claude last, ties keep input order. */
export const sortBySubscriptionExpiry = <T extends AuthFileItem>(
  files: T[],
  now?: SubscriptionNow
): T[] =>
  files
    .map((file, index) => ({ file, index, key: subscriptionSortKey(file, now) }))
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
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return normalizeSubscriptionDate(`${y}-${pad2(m)}-${pad2(d)}`);
};

export type SubscriptionBadgeTier = 'active' | 'warning' | 'today' | 'expired' | 'unset';

export type SubscriptionBadge = {
  tier: SubscriptionBadgeTier;
  /** CSS tone: today shares the warning colour. */
  tone: AuthFileSubscriptionState;
  /** Remaining text: `N天` / `N小时` / `今天到期` / `已过期` / `未设置订阅`. */
  remainingKey: string;
  remainingParams: Record<string, string | number>;
  /** Exact expiry, `YYYY-MM-DD HH:mm` (Beijing time); empty when unset. */
  expiresText: string;
  tooltipKey: string | null;
  tooltipParams: Record<string, string | number>;
};

export const describeSubscriptionBadge = (period: SubscriptionPeriod): SubscriptionBadge => {
  const tooltipParams = {
    start: period.start ?? '',
    from: period.periodStart ?? '',
    to: period.periodEnd ?? '',
  };
  const tooltipKey =
    period.state === 'unset' || !period.periodEnd
      ? null
      : period.autoRenew
        ? 'auth_files.subscription_tooltip_auto'
        : 'auth_files.subscription_tooltip';
  const expiresText = period.periodEnd ?? '';
  const seconds = period.secondsLeft;

  if (period.state === 'unset' || seconds === undefined) {
    return {
      tier: 'unset',
      tone: 'unset',
      remainingKey: 'auth_files.subscription_badge_unset',
      remainingParams: {},
      expiresText: '',
      tooltipKey: null,
      tooltipParams,
    };
  }
  const base = { expiresText, tooltipKey, tooltipParams };
  if (seconds <= 0) {
    return {
      ...base,
      tier: 'expired',
      tone: 'expired',
      remainingKey: 'auth_files.subscription_remaining_expired',
      remainingParams: {},
    };
  }
  const days = Math.floor(seconds / 86_400);
  if (days < 1) {
    const hours = Math.floor(seconds / 3600);
    return {
      ...base,
      tier: 'today',
      tone: 'warning',
      remainingKey:
        hours >= 1
          ? 'auth_files.subscription_remaining_hours'
          : 'auth_files.subscription_remaining_today',
      remainingParams: hours >= 1 ? { hours } : {},
    };
  }
  const warning = seconds <= SUBSCRIPTION_WARNING_DAYS * 86_400;
  return {
    ...base,
    tier: warning ? 'warning' : 'active',
    tone: warning ? 'warning' : 'active',
    remainingKey: 'auth_files.subscription_remaining_days',
    remainingParams: { days },
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

/** Editor draft: a date input plus an optional `HH:mm` time input for start and end. */
export type SubscriptionDraft = {
  start: string;
  startTime: string;
  cycle: AuthFileSubscriptionCycle;
  autoRenew: boolean;
  end: string;
  endTime: string;
};

/** Split a stored value into the editor's date and optional time parts. */
export const splitSubscriptionValue = (value: string | null | undefined) => {
  const canonical = normalizeSubscriptionDate(value);
  if (!canonical) return { date: '', time: '' };
  return { date: canonical.slice(0, 10), time: canonical.length > 10 ? canonical.slice(11) : '' };
};

/** Join a date and optional time into the wire value; null when invalid or empty. */
export const joinSubscriptionValue = (date: string, time: string): string | null => {
  const dateText = date.trim();
  const timeText = time.trim();
  if (!dateText) return null;
  if (!timeText) return normalizeSubscriptionDate(dateText);
  const match = TIME_RE.exec(timeText.length > 5 ? timeText.slice(0, 5) : timeText);
  if (!match) return null;
  return normalizeSubscriptionDate(`${dateText} ${match[1]}:${match[2]}`);
};

export const validateSubscriptionDraft = (
  draft: SubscriptionDraft
): SubscriptionDraftError | null => {
  const startText = draft.start.trim();
  const endText = draft.end.trim();
  if (!startText) {
    return endText || draft.startTime.trim() || draft.endTime.trim()
      ? 'auth_files.subscription_start_required'
      : null;
  }
  const start = joinSubscriptionValue(draft.start, draft.startTime);
  if (!start) return 'auth_files.subscription_invalid_start';
  if (!endText) return draft.endTime.trim() ? 'auth_files.subscription_invalid_end' : null;
  const end = joinSubscriptionValue(draft.end, draft.endTime);
  if (!end) return 'auth_files.subscription_invalid_end';
  if ((parseSubscriptionInstant(end) as number) < (parseSubscriptionInstant(start) as number)) {
    return 'auth_files.subscription_end_before_start';
  }
  return null;
};

/** Draft → preview input for computeSubscriptionPeriod. */
export const subscriptionDraftToInput = (draft: SubscriptionDraft): SubscriptionInput => ({
  start: joinSubscriptionValue(draft.start, draft.startTime),
  cycle: draft.cycle,
  autoRenew: draft.autoRenew,
  end: joinSubscriptionValue(draft.end, draft.endTime),
});

/** Draft → wire value; null means "delete the subscription". Throws nothing; validate first. */
export const subscriptionDraftToPatch = (
  draft: SubscriptionDraft
): SubscriptionPatchValue | null => {
  const start = joinSubscriptionValue(draft.start, draft.startTime);
  if (!start) return null;
  return {
    start,
    cycle: draft.cycle === 'annual' ? 'annual' : 'monthly',
    auto_renew: draft.autoRenew,
    end: joinSubscriptionValue(draft.end, draft.endTime),
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

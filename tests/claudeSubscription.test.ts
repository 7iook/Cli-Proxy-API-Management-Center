import { describe, expect, test } from 'bun:test';
import {
  addSubscriptionMonths,
  computeSubscriptionPeriod,
  describeSubscriptionBadge,
  formatSubscriptionInstant,
  isSubscriptionExpiring,
  joinSubscriptionValue,
  normalizeSubscriptionDate,
  parseSubscriptionDateFromNote,
  parseSubscriptionInstant,
  readAuthFileSubscription,
  resolveSubscriptionPeriod,
  sortBySubscriptionExpiry,
  subscriptionDraftToPatch,
  subscriptionToday,
  validateSubscriptionDraft,
} from '../src/features/authFiles/subscription';
import {
  buildAuthFileFieldsPatch,
  readSubscriptionDraft,
  type PrefixProxyEditorState,
} from '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import type { AuthFileItem } from '../src/types';

const draft = (
  overrides: Partial<{
    start: string;
    startTime: string;
    cycle: 'monthly' | 'annual';
    autoRenew: boolean;
    end: string;
    endTime: string;
  }> = {}
) => ({
  start: '',
  startTime: '',
  cycle: 'monthly' as const,
  autoRenew: false,
  end: '',
  endTime: '',
  ...overrides,
});

describe('subscription period math', () => {
  test('adds calendar months clamped to month end from the original anchor', () => {
    expect(addSubscriptionMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addSubscriptionMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addSubscriptionMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addSubscriptionMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addSubscriptionMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addSubscriptionMonths('2024-02-29', 12)).toBe('2025-02-28');
    // Time of day is kept.
    expect(addSubscriptionMonths('2026-01-31 14:35', 1)).toBe('2026-02-28 14:35');
  });

  test('single period when auto-renew is off (default); date-only means 00:00', () => {
    const period = computeSubscriptionPeriod({ start: '2026-11-03' }, '2026-11-10');
    expect(period.periodStart).toBe('2026-11-03 00:00');
    expect(period.periodEnd).toBe('2026-12-03 00:00');
    expect(period.daysLeft).toBe(23);
    expect(period.secondsLeft).toBe(23 * 86_400);
    expect(period.state).toBe('active');

    const expired = computeSubscriptionPeriod({ start: '2026-09-02' }, '2026-11-02');
    expect(expired.periodEnd).toBe('2026-10-02 00:00');
    expect(expired.daysLeft).toBe(-31);
    expect(expired.state).toBe('expired');
  });

  test('auto-renew rolls to the current period', () => {
    const period = computeSubscriptionPeriod(
      { start: '2026-01-31', autoRenew: true },
      '2026-03-15'
    );
    expect(period.periodStart).toBe('2026-02-28 00:00');
    expect(period.periodEnd).toBe('2026-03-31 00:00');
    const onAnchor = computeSubscriptionPeriod(
      { start: '2026-09-02', autoRenew: true },
      '2026-11-02'
    );
    expect(onAnchor.periodStart).toBe('2026-11-02 00:00');
    expect(onAnchor.periodEnd).toBe('2026-12-02 00:00');
    expect(onAnchor.daysLeft).toBe(30);
  });

  test('annual cycle and manual end override', () => {
    const annual = computeSubscriptionPeriod(
      { start: '2026-03-01', cycle: 'annual' },
      '2026-11-02'
    );
    expect(annual.periodEnd).toBe('2027-03-01 00:00');
    const ended = computeSubscriptionPeriod(
      { start: '2026-10-18', autoRenew: true, end: '2026-11-05' },
      '2026-11-02'
    );
    expect(ended.periodStart).toBe('2026-10-18 00:00');
    expect(ended.periodEnd).toBe('2026-11-05 00:00');
    expect(ended.daysLeft).toBe(3);
    expect(ended.state).toBe('warning');
  });

  test('warning threshold, expiry instant and unset', () => {
    expect(computeSubscriptionPeriod({ start: '2026-10-09' }, '2026-11-02').state).toBe('warning');
    expect(computeSubscriptionPeriod({ start: '2026-10-10' }, '2026-11-02').state).toBe('active');
    // now == expiry → expired.
    const atExpiry = computeSubscriptionPeriod({ start: '2026-10-02' }, '2026-11-02');
    expect(atExpiry.secondsLeft).toBe(0);
    expect(atExpiry.state).toBe('expired');
    expect(computeSubscriptionPeriod(null, '2026-11-02').state).toBe('unset');
    expect(computeSubscriptionPeriod({ start: '2026-02-30' }, '2026-11-02').state).toBe('unset');
  });

  test('minute precision: start time carries into expiry and remaining time', () => {
    const period = computeSubscriptionPeriod({ start: '2026-10-05 14:30' }, '2026-11-05 02:30');
    expect(period.periodStart).toBe('2026-10-05 14:30');
    expect(period.periodEnd).toBe('2026-11-05 14:30');
    expect(period.secondsLeft).toBe(12 * 3600);
    expect(period.daysLeft).toBe(0);
    expect(period.state).toBe('warning');
    expect(computeSubscriptionPeriod({ start: '2026-10-05T14:30' }, '2026-11-05 14:30').state).toBe(
      'expired'
    );
    expect(
      computeSubscriptionPeriod({ start: '2026-10-05 14:30' }, '2026-11-05 14:29').secondsLeft
    ).toBe(60);
    // Epoch-ms now (Beijing 2026-11-05 14:00 == 06:00 UTC).
    expect(
      computeSubscriptionPeriod({ start: '2026-10-05 14:30' }, Date.UTC(2026, 10, 5, 6, 0))
        .secondsLeft
    ).toBe(1800);
    const manual = computeSubscriptionPeriod(
      { start: '2026-10-05 08:00', autoRenew: true, end: '2026-11-20 23:59' },
      '2026-11-19 23:59'
    );
    expect(manual.periodStart).toBe('2026-11-05 08:00');
    expect(manual.periodEnd).toBe('2026-11-20 23:59');
    expect(manual.daysLeft).toBe(1);
  });

  test('value parsing and Beijing instants', () => {
    expect(normalizeSubscriptionDate('2026-11-03')).toBe('2026-11-03');
    expect(normalizeSubscriptionDate('2026-11-03T09:05')).toBe('2026-11-03 09:05');
    expect(normalizeSubscriptionDate(' 2026-11-03 09:05 ')).toBe('2026-11-03 09:05');
    expect(normalizeSubscriptionDate('2026-11-03 24:00')).toBeNull();
    expect(normalizeSubscriptionDate('2026-11-03 09:60')).toBeNull();
    expect(normalizeSubscriptionDate('2026-11-03 9:05')).toBeNull();
    expect(parseSubscriptionInstant('2026-11-03')).toBe(Date.UTC(2026, 10, 2, 16, 0));
    expect(parseSubscriptionInstant('2026-11-03 09:05')).toBe(Date.UTC(2026, 10, 3, 1, 5));
    expect(formatSubscriptionInstant(Date.UTC(2026, 10, 2, 16, 0))).toBe('2026-11-03 00:00');
    expect(joinSubscriptionValue('2026-11-03', '')).toBe('2026-11-03');
    expect(joinSubscriptionValue('2026-11-03', '18:45')).toBe('2026-11-03 18:45');
    expect(joinSubscriptionValue('2026-11-03', '18:45:00')).toBe('2026-11-03 18:45');
    expect(joinSubscriptionValue('', '18:45')).toBeNull();
  });

  test('today is the Beijing calendar day', () => {
    // 2026-11-02 17:00 UTC == 2026-11-03 01:00 Asia/Shanghai
    expect(subscriptionToday(Date.UTC(2026, 10, 2, 17, 0))).toBe('2026-11-03');
    expect(subscriptionToday(Date.UTC(2026, 10, 2, 15, 59))).toBe('2026-11-02');
  });
});

describe('backend fields and presentation', () => {
  test('normalizes the backend shape and recomputes remaining time from its expiry', () => {
    const sub = readAuthFileSubscription({
      start: '2026-11-03',
      cycle: 'monthly',
      auto_renew: false,
      end: null,
      period_start: '2026-11-03 00:00',
      period_end: '2026-12-03 00:00',
      expires_at: '2026-12-03T00:00:00+08:00',
      days_left: 31,
      seconds_left: 31 * 86_400,
      state: 'active',
    });
    expect(sub).toMatchObject({
      start: '2026-11-03',
      cycle: 'monthly',
      autoRenew: false,
      end: null,
      periodStart: '2026-11-03 00:00',
      periodEnd: '2026-12-03 00:00',
      expiresAt: '2026-12-03T00:00:00+08:00',
      daysLeft: 31,
      secondsLeft: 31 * 86_400,
      state: 'active',
    });
    const resolved = resolveSubscriptionPeriod(sub, '2026-11-25 12:00');
    expect(resolved.periodEnd).toBe('2026-12-03 00:00');
    expect(resolved.daysLeft).toBe(7);
    expect(resolved.secondsLeft).toBe(7 * 86_400 + 12 * 3600);
    expect(resolved.state).toBe('active');
    expect(readAuthFileSubscription(null)).toBeUndefined();
    expect(readAuthFileSubscription({ cycle: 'monthly' })).toBeUndefined();
  });

  test('older backends: date-only period_end is read as 00:00', () => {
    const sub = readAuthFileSubscription({
      start: '2026-10-05',
      period_start: '2026-10-05',
      period_end: '2026-11-05',
      days_left: 3,
      state: 'warning',
    });
    const resolved = resolveSubscriptionPeriod(sub, '2026-11-04 18:00');
    expect(resolved.periodEnd).toBe('2026-11-05 00:00');
    expect(resolved.secondsLeft).toBe(6 * 3600);
  });

  test('badge: remaining text, tone and exact expiry', () => {
    const active = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-11-03' }, '2026-11-10')
    );
    expect(active.tier).toBe('active');
    expect(active.tone).toBe('active');
    expect(active.remainingKey).toBe('auth_files.subscription_remaining_days');
    expect(active.remainingParams).toEqual({ days: 23 });
    expect(active.expiresText).toBe('2026-12-03 00:00');
    expect(active.tooltipParams).toEqual({
      start: '2026-11-03',
      from: '2026-11-03 00:00',
      to: '2026-12-03 00:00',
    });
    const warning = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-05' }, '2026-11-02 08:00')
    );
    expect(warning.tier).toBe('warning');
    expect(warning.remainingParams).toEqual({ days: 2 });
    const hours = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-05 14:30' }, '2026-11-05 02:00')
    );
    expect(hours.tier).toBe('today');
    expect(hours.tone).toBe('warning');
    expect(hours.remainingKey).toBe('auth_files.subscription_remaining_hours');
    expect(hours.remainingParams).toEqual({ hours: 12 });
    expect(hours.expiresText).toBe('2026-11-05 14:30');
    const lastHour = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-05 14:30' }, '2026-11-05 14:00')
    );
    expect(lastHour.remainingKey).toBe('auth_files.subscription_remaining_today');
    const expired = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-30' }, '2026-12-02')
    );
    expect(expired.tier).toBe('expired');
    expect(expired.tone).toBe('expired');
    expect(expired.remainingKey).toBe('auth_files.subscription_remaining_expired');
    expect(expired.expiresText).toBe('2026-11-30 00:00');
    const unset = describeSubscriptionBadge(computeSubscriptionPeriod(null));
    expect(unset.tier).toBe('unset');
    expect(unset.remainingKey).toBe('auth_files.subscription_badge_unset');
  });

  test('parses subscription dates from notes', () => {
    expect(parseSubscriptionDateFromNote('max 订阅2026-10-18 主力')).toBe('2026-10-18');
    expect(parseSubscriptionDateFromNote('2026-1-5')).toBe('2026-01-05');
    expect(parseSubscriptionDateFromNote('订阅2026-02-30')).toBeNull();
    expect(parseSubscriptionDateFromNote('no date')).toBeNull();
    expect(parseSubscriptionDateFromNote(undefined)).toBeNull();
  });
});

describe('sorting and filtering', () => {
  const file = (name: string, type: string, start?: string): AuthFileItem => ({
    name,
    type,
    ...(start ? { subscription: { start, cycle: 'monthly', autoRenew: false } } : {}),
  });

  test('sorts soonest expiry first and unset / non-Claude last', () => {
    const files = [
      file('a', 'claude'),
      file('b', 'claude', '2026-10-20'),
      file('c', 'codex', '2026-10-01'),
      file('d', 'claude', '2026-09-01'),
      file('e', 'claude', '2026-10-05'),
    ];
    expect(sortBySubscriptionExpiry(files, '2026-11-02').map((f) => f.name)).toEqual([
      'd',
      'e',
      'b',
      'a',
      'c',
    ]);
  });

  test('sorts by exact expiry minute within the same day', () => {
    const files = [
      file('late', 'claude', '2026-10-05 18:00'),
      file('midnight', 'claude', '2026-10-05'),
      file('early', 'claude', '2026-10-05 09:15'),
    ];
    expect(sortBySubscriptionExpiry(files, '2026-11-02').map((f) => f.name)).toEqual([
      'midnight',
      'early',
      'late',
    ]);
  });

  test('expiring filter matches warning and expired Claude files only', () => {
    expect(isSubscriptionExpiring(file('x', 'claude', '2026-10-05'), '2026-11-02')).toBe(true);
    expect(isSubscriptionExpiring(file('x', 'claude', '2026-09-05'), '2026-11-02')).toBe(true);
    expect(isSubscriptionExpiring(file('x', 'claude', '2026-10-25'), '2026-11-02')).toBe(false);
    expect(isSubscriptionExpiring(file('x', 'claude'), '2026-11-02')).toBe(false);
    expect(isSubscriptionExpiring(file('x', 'codex', '2026-10-05'), '2026-11-02')).toBe(false);
  });
});

describe('editor patch', () => {
  const makeEditor = (
    json: Record<string, unknown>,
    subscription: PrefixProxyEditorState['subscription'],
    providerKey = 'claude'
  ): PrefixProxyEditorState => ({
    fileName: 'claude.json',
    fileInfoText: '',
    loading: false,
    saving: false,
    error: null,
    originalText: JSON.stringify(json),
    rawText: JSON.stringify(json),
    invalidContentPreview: '',
    json,
    providerKey,
    prefix: '',
    proxyUrl: '',
    priority: '',
    weight: '',
    weightError: null,
    disableCooling: false,
    disableCoolingTouched: false,
    websockets: false,
    websocketsTouched: false,
    useSiwc: false,
    useSiwcTouched: false,
    usingApi: false,
    usingApiTouched: false,
    note: '',
    noteTouched: false,
    subscription,
    subscriptionTouched: true,
    subscriptionError: null,
    excludedModelsText: '',
    excludedModelsTouched: false,
    headersText: '',
    headersTouched: false,
    headersError: null,
  });
  const t = (key: string) => key;

  test('sends a new subscription object', () => {
    const patch = buildAuthFileFieldsPatch(makeEditor({}, draft({ start: '2026-11-03' })), t);
    expect(patch.subscription).toEqual({
      start: '2026-11-03',
      cycle: 'monthly',
      auto_renew: false,
      end: null,
    });
  });

  test('unchanged subscription produces no patch; clearing sends null', () => {
    const json = {
      subscription: { start: '2026-11-03', cycle: 'monthly', auto_renew: true, end: null },
    };
    const stored = readSubscriptionDraft(json);
    expect(stored).toEqual(draft({ start: '2026-11-03', autoRenew: true }));
    expect(buildAuthFileFieldsPatch(makeEditor(json, stored), t).subscription).toBeUndefined();
    const cleared = buildAuthFileFieldsPatch(makeEditor(json, draft()), t);
    expect(cleared.subscription).toBeNull();
  });

  test('ignored for non-Claude files and validates drafts', () => {
    const patch = buildAuthFileFieldsPatch(
      makeEditor({}, draft({ start: '2026-11-03' }), 'codex'),
      t
    );
    expect(patch.subscription).toBeUndefined();
    expect(() =>
      buildAuthFileFieldsPatch(makeEditor({}, draft({ start: '2026-11-03', end: '2026-11-01' })), t)
    ).toThrow('auth_files.subscription_end_before_start');
    expect(validateSubscriptionDraft(draft({ end: '2026-11-01' }))).toBe(
      'auth_files.subscription_start_required'
    );
    expect(
      subscriptionDraftToPatch(draft({ start: ' ', cycle: 'annual', autoRenew: true }))
    ).toBeNull();
  });

  test('minute precision drafts: split, join and validate', () => {
    const json = {
      subscription: {
        start: '2026-11-03 09:30',
        cycle: 'monthly',
        auto_renew: false,
        end: '2026-12-01 23:59',
      },
    };
    const stored = readSubscriptionDraft(json);
    expect(stored).toEqual(
      draft({ start: '2026-11-03', startTime: '09:30', end: '2026-12-01', endTime: '23:59' })
    );
    expect(buildAuthFileFieldsPatch(makeEditor(json, stored), t).subscription).toBeUndefined();
    const patch = buildAuthFileFieldsPatch(
      makeEditor({}, draft({ start: '2026-11-03', startTime: '14:05' })),
      t
    );
    expect(patch.subscription).toEqual({
      start: '2026-11-03 14:05',
      cycle: 'monthly',
      auto_renew: false,
      end: null,
    });
    // Same day: end time before start time is rejected; equal instants are fine.
    expect(
      validateSubscriptionDraft(
        draft({ start: '2026-11-03', startTime: '14:05', end: '2026-11-03', endTime: '14:00' })
      )
    ).toBe('auth_files.subscription_end_before_start');
    expect(
      validateSubscriptionDraft(
        draft({ start: '2026-11-03', startTime: '14:05', end: '2026-11-03', endTime: '14:05' })
      )
    ).toBeNull();
    expect(validateSubscriptionDraft(draft({ startTime: '10:00' }))).toBe(
      'auth_files.subscription_start_required'
    );
    expect(validateSubscriptionDraft(draft({ start: '2026-11-03', endTime: '10:00' }))).toBe(
      'auth_files.subscription_invalid_end'
    );
    expect(validateSubscriptionDraft(draft({ start: '2026-11-03', startTime: '25:00' }))).toBe(
      'auth_files.subscription_invalid_start'
    );
  });
});

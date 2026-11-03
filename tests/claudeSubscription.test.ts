import { describe, expect, test } from 'bun:test';
import {
  addSubscriptionMonths,
  computeSubscriptionPeriod,
  describeSubscriptionBadge,
  isSubscriptionExpiring,
  parseSubscriptionDateFromNote,
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

describe('subscription period math', () => {
  test('adds calendar months clamped to month end from the original anchor', () => {
    expect(addSubscriptionMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addSubscriptionMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addSubscriptionMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addSubscriptionMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addSubscriptionMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addSubscriptionMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  test('single period when auto-renew is off (default)', () => {
    const period = computeSubscriptionPeriod({ start: '2026-11-03' }, '2026-11-10');
    expect(period.periodStart).toBe('2026-11-03');
    expect(period.periodEnd).toBe('2026-12-03');
    expect(period.daysLeft).toBe(23);
    expect(period.state).toBe('active');

    const expired = computeSubscriptionPeriod({ start: '2026-09-02' }, '2026-11-02');
    expect(expired.periodEnd).toBe('2026-10-02');
    expect(expired.daysLeft).toBe(-31);
    expect(expired.state).toBe('expired');
  });

  test('auto-renew rolls to the current period', () => {
    const period = computeSubscriptionPeriod(
      { start: '2026-01-31', autoRenew: true },
      '2026-03-15'
    );
    expect(period.periodStart).toBe('2026-02-28');
    expect(period.periodEnd).toBe('2026-03-31');
    const onAnchor = computeSubscriptionPeriod(
      { start: '2026-09-02', autoRenew: true },
      '2026-11-02'
    );
    expect(onAnchor.periodStart).toBe('2026-11-02');
    expect(onAnchor.periodEnd).toBe('2026-12-02');
    expect(onAnchor.daysLeft).toBe(30);
  });

  test('annual cycle and manual end override', () => {
    const annual = computeSubscriptionPeriod(
      { start: '2026-03-01', cycle: 'annual' },
      '2026-11-02'
    );
    expect(annual.periodEnd).toBe('2027-03-01');
    const ended = computeSubscriptionPeriod(
      { start: '2026-10-18', autoRenew: true, end: '2026-11-05' },
      '2026-11-02'
    );
    expect(ended.periodEnd).toBe('2026-11-05');
    expect(ended.daysLeft).toBe(3);
    expect(ended.state).toBe('warning');
  });

  test('warning threshold, today and unset', () => {
    expect(computeSubscriptionPeriod({ start: '2026-10-09' }, '2026-11-02').state).toBe('warning');
    expect(computeSubscriptionPeriod({ start: '2026-10-10' }, '2026-11-02').state).toBe('active');
    const today = computeSubscriptionPeriod({ start: '2026-10-02' }, '2026-11-02');
    expect(today.daysLeft).toBe(0);
    expect(describeSubscriptionBadge(today).tier).toBe('today');
    expect(computeSubscriptionPeriod(null, '2026-11-02').state).toBe('unset');
    expect(computeSubscriptionPeriod({ start: '2026-02-30' }, '2026-11-02').state).toBe('unset');
  });

  test('today is the Beijing calendar day', () => {
    // 2026-11-02 17:00 UTC == 2026-11-03 01:00 Asia/Shanghai
    expect(subscriptionToday(Date.UTC(2026, 10, 2, 17, 0))).toBe('2026-11-03');
    expect(subscriptionToday(Date.UTC(2026, 10, 2, 15, 59))).toBe('2026-11-02');
  });
});

describe('backend fields and presentation', () => {
  test('normalizes the backend shape and prefers its computed fields', () => {
    const sub = readAuthFileSubscription({
      start: '2026-11-03',
      cycle: 'monthly',
      auto_renew: false,
      end: null,
      period_start: '2026-11-03',
      period_end: '2026-12-03',
      days_left: 31,
      state: 'active',
    });
    expect(sub).toEqual({
      start: '2026-11-03',
      cycle: 'monthly',
      autoRenew: false,
      end: null,
      periodStart: '2026-11-03',
      periodEnd: '2026-12-03',
      daysLeft: 31,
      state: 'active',
    });
    const resolved = resolveSubscriptionPeriod(sub, '2026-11-25');
    expect(resolved.daysLeft).toBe(31);
    expect(readAuthFileSubscription(null)).toBeUndefined();
    expect(readAuthFileSubscription({ cycle: 'monthly' })).toBeUndefined();
  });

  test('badge tiers and labels', () => {
    const active = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-11-03' }, '2026-11-10')
    );
    expect(active.tier).toBe('active');
    expect(active.labelParams).toEqual({ days: 23, date: '12-03' });
    expect(active.tooltipParams).toEqual({ start: '2026-11-03', from: '11-03', to: '12-03' });
    const expired = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-30' }, '2026-12-02')
    );
    expect(expired.tier).toBe('expired');
    expect(expired.tone).toBe('expired');
    expect(expired.labelParams).toEqual({ days: 2, date: '11-30' });
    const warning = describeSubscriptionBadge(
      computeSubscriptionPeriod({ start: '2026-10-05' }, '2026-11-02')
    );
    expect(warning.tier).toBe('warning');
    expect(warning.labelParams.days).toBe(3);
    expect(describeSubscriptionBadge(computeSubscriptionPeriod(null)).tier).toBe('unset');
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
    const patch = buildAuthFileFieldsPatch(
      makeEditor({}, { start: '2026-11-03', cycle: 'monthly', autoRenew: false, end: '' }),
      t
    );
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
    const draft = readSubscriptionDraft(json);
    expect(draft).toEqual({ start: '2026-11-03', cycle: 'monthly', autoRenew: true, end: '' });
    expect(buildAuthFileFieldsPatch(makeEditor(json, draft), t).subscription).toBeUndefined();
    const cleared = buildAuthFileFieldsPatch(
      makeEditor(json, { start: '', cycle: 'monthly', autoRenew: false, end: '' }),
      t
    );
    expect(cleared.subscription).toBeNull();
  });

  test('ignored for non-Claude files and validates drafts', () => {
    const patch = buildAuthFileFieldsPatch(
      makeEditor({}, { start: '2026-11-03', cycle: 'monthly', autoRenew: false, end: '' }, 'codex'),
      t
    );
    expect(patch.subscription).toBeUndefined();
    expect(() =>
      buildAuthFileFieldsPatch(
        makeEditor(
          {},
          { start: '2026-11-03', cycle: 'monthly', autoRenew: false, end: '2026-11-01' }
        ),
        t
      )
    ).toThrow('auth_files.subscription_end_before_start');
    expect(
      validateSubscriptionDraft({
        start: '',
        cycle: 'monthly',
        autoRenew: false,
        end: '2026-11-01',
      })
    ).toBe('auth_files.subscription_start_required');
    expect(
      subscriptionDraftToPatch({ start: ' ', cycle: 'annual', autoRenew: true, end: '' })
    ).toBeNull();
  });
});

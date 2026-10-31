import { describe, expect, test } from 'bun:test';
import {
  resolveQuotaSortKey,
  sortByQuotaKey,
  type QuotaSortKey,
} from '@/features/quota/quotaSortKey';

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;
const FUTURE = NOW + 2 * HOUR;

const value = (
  remaining: number,
  resetAtMs: number | null = FUTURE,
  reset = false
): QuotaSortKey => ({
  status: 'value',
  remaining,
  resetAtMs,
  reset,
});

const win = (
  id: string,
  usedPercent: number | null,
  periodHours: number | null,
  resetAtMs = FUTURE
) => ({
  id,
  label: id,
  usedPercent,
  resetLabel: '',
  resetAtMs,
  periodHours,
});

describe('resolveQuotaSortKey states', () => {
  test('null provider is na', () => {
    expect(resolveQuotaSortKey(null, undefined, 'weekly', NOW)).toEqual({ status: 'na' });
  });

  test('undefined, loading and error quota are missing', () => {
    expect(resolveQuotaSortKey('codex', undefined, 'weekly', NOW)).toEqual({ status: 'missing' });
    for (const status of ['idle', 'loading', 'error']) {
      expect(resolveQuotaSortKey('codex', { status, windows: [] }, 'weekly', NOW)).toEqual({
        status: 'missing',
      });
    }
  });

  test('success without a matching window is na', () => {
    const quota = { status: 'success', windows: [win('daily', 10, 24)] };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual({ status: 'na' });
    expect(resolveQuotaSortKey('codex', quota, 'fiveHour', NOW)).toEqual({ status: 'na' });
  });

  test('windows without usable periodHours are ignored', () => {
    const quota = { status: 'success', windows: [win('weekly', 10, null)] };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual({ status: 'na' });
  });

  test('period boundaries are inclusive', () => {
    const at = (h: number) => ({ status: 'success', windows: [win('x', 50, h)] });
    expect(resolveQuotaSortKey('codex', at(4), 'fiveHour', NOW).status).toBe('value');
    expect(resolveQuotaSortKey('codex', at(6), 'fiveHour', NOW).status).toBe('value');
    expect(resolveQuotaSortKey('codex', at(6.5), 'fiveHour', NOW).status).toBe('na');
    expect(resolveQuotaSortKey('codex', at(144), 'weekly', NOW).status).toBe('value');
    expect(resolveQuotaSortKey('codex', at(192), 'weekly', NOW).status).toBe('value');
    expect(resolveQuotaSortKey('codex', at(193), 'weekly', NOW).status).toBe('na');
  });
});

describe('codex and claude', () => {
  test('codex prefers account-level ids over lower model-scoped windows', () => {
    const quota = {
      status: 'success',
      windows: [
        win('five-hour', 20, 5),
        win('code-review-five-hour', 90, 5),
        win('weekly', 30, 168),
        win('additional-weekly', 95, 168),
      ],
    };
    expect(resolveQuotaSortKey('codex', quota, 'fiveHour', NOW)).toEqual(value(80));
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(70));
  });

  test('codex without preferred id takes the bottleneck', () => {
    const quota = {
      status: 'success',
      windows: [win('a', 20, 168, FUTURE + 5), win('b', 60, 168, FUTURE)],
    };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(40, FUTURE));
  });

  test('claude prefers seven-day over model-scoped windows', () => {
    const quota = {
      status: 'success',
      windows: [
        win('five-hour', 10, 5),
        win('seven-day', 25, 168),
        win('seven-day-opus', 99, 168),
        win('seven-day-fable', 80, 168),
        win('cloud-session-credits', 100, null),
      ],
    };
    expect(resolveQuotaSortKey('claude', quota, 'weekly', NOW)).toEqual(value(75));
    expect(resolveQuotaSortKey('claude', quota, 'fiveHour', NOW)).toEqual(value(90));
  });

  test('claude falls back to the lowest model-scoped window when seven-day is absent', () => {
    const quota = {
      status: 'success',
      windows: [win('seven-day-opus', 40, 168), win('seven-day-sonnet', 70, 168)],
    };
    expect(resolveQuotaSortKey('claude', quota, 'weekly', NOW)).toEqual(value(30));
  });

  test('null usedPercent is skipped', () => {
    const quota = {
      status: 'success',
      windows: [win('weekly', null, 168), win('other', 10, 168)],
    };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(90));
  });

  test('clamps out-of-range percent', () => {
    const quota = { status: 'success', windows: [win('weekly', 130, 168)] };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(0));
  });

  test('passed reset yields full quota and keeps resetAtMs', () => {
    const past = NOW - 1000;
    const quota = { status: 'success', windows: [win('weekly', 100, 168, past)] };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(100, past, true));
  });

  test('reset exactly now counts as reset', () => {
    const quota = { status: 'success', windows: [win('weekly', 90, 168, NOW)] };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(100, NOW, true));
  });

  test('a reset window is not the bottleneck any more', () => {
    const quota = {
      status: 'success',
      windows: [win('a', 100, 168, NOW - 1), win('b', 50, 168)],
    };
    expect(resolveQuotaSortKey('claude', quota, 'weekly', NOW)).toEqual(value(50));
  });

  test('missing resetAtMs gives null and no reset', () => {
    const quota = {
      status: 'success',
      windows: [{ id: 'weekly', label: 'w', usedPercent: 10, resetLabel: '', periodHours: 168 }],
    };
    expect(resolveQuotaSortKey('codex', quota, 'weekly', NOW)).toEqual(value(90, null));
  });
});

describe('other providers', () => {
  test('devin uses remainingPercent', () => {
    const quota = {
      status: 'success',
      windows: [
        { id: 'daily', remainingPercent: 10, resetAtMs: FUTURE, periodHours: 24 },
        { id: 'weekly', remainingPercent: 65, resetAtMs: FUTURE, periodHours: 168 },
      ],
    };
    expect(resolveQuotaSortKey('devin', quota, 'weekly', NOW)).toEqual(value(65));
    expect(resolveQuotaSortKey('devin', quota, 'fiveHour', NOW)).toEqual({ status: 'na' });
    expect(resolveQuotaSortKey('devin', { status: 'loading', windows: [] }, 'weekly', NOW)).toEqual(
      {
        status: 'missing',
      }
    );
  });

  test('meta converts seconds to ms and defaults weekly to 7 days', () => {
    const resetSec = Math.floor(FUTURE / 1000);
    const quota = {
      status: 'success',
      data: {
        windows: [
          { id: 'window', usedPercent: 30, resetAt: resetSec, durationMinutes: 300 },
          { id: 'weekly', usedPercent: 60, resetAt: resetSec },
        ],
      },
    };
    expect(resolveQuotaSortKey('meta', quota, 'fiveHour', NOW)).toEqual(value(70, resetSec * 1000));
    expect(resolveQuotaSortKey('meta', quota, 'weekly', NOW)).toEqual(value(40, resetSec * 1000));
  });

  test('meta reset in seconds in the past counts as reset', () => {
    const quota = {
      status: 'success',
      data: { windows: [{ id: 'window', usedPercent: 99, resetAt: 1, durationMinutes: 300 }] },
    };
    expect(resolveQuotaSortKey('meta', quota, 'fiveHour', NOW)).toEqual(value(100, 1000, true));
  });

  test('meta without data is na', () => {
    expect(resolveQuotaSortKey('meta', { status: 'success' }, 'weekly', NOW)).toEqual({
      status: 'na',
    });
  });

  test('antigravity uses remainingFraction inside groups and takes the bottleneck', () => {
    const quota = {
      status: 'success',
      groups: [
        {
          id: 'g1',
          label: 'g1',
          buckets: [
            { id: 'a', label: 'a', remainingFraction: 0.8, resetAtMs: FUTURE, periodHours: 168 },
            { id: 'b', label: 'b', remainingFraction: 0.25, resetAtMs: FUTURE, periodHours: 168 },
          ],
        },
        {
          id: 'g2',
          label: 'g2',
          buckets: [
            { id: 'c', label: 'c', remainingFraction: 0.5, resetAtMs: FUTURE, periodHours: 5 },
          ],
        },
      ],
    };
    expect(resolveQuotaSortKey('antigravity', quota, 'weekly', NOW)).toEqual(value(25));
    expect(resolveQuotaSortKey('antigravity', quota, 'fiveHour', NOW)).toEqual(value(50));
  });

  test('plugin shares the bucket shape', () => {
    const quota = {
      status: 'success',
      summary: [],
      groups: [
        {
          id: 'g',
          label: 'g',
          buckets: [
            { id: 'a', label: 'a', remainingFraction: 0.4, resetAtMs: FUTURE, periodHours: 168 },
          ],
        },
      ],
    };
    expect(resolveQuotaSortKey('plugin', quota, 'weekly', NOW)).toEqual(value(40));
    expect(resolveQuotaSortKey('plugin', quota, 'fiveHour', NOW)).toEqual({ status: 'na' });
  });

  test('antigravity bucket without periodHours is na', () => {
    const quota = {
      status: 'success',
      groups: [{ id: 'g', label: 'g', buckets: [{ id: 'a', label: 'a', remainingFraction: 0.4 }] }],
    };
    expect(resolveQuotaSortKey('antigravity', quota, 'weekly', NOW)).toEqual({ status: 'na' });
  });

  test('kimi derives remaining from used/limit and skips limit 0', () => {
    const quota = {
      status: 'success',
      rows: [
        { id: 'zero', used: 0, limit: 0, resetAtMs: FUTURE, periodHours: 168 },
        { id: 'w', used: 25, limit: 100, resetAtMs: FUTURE, periodHours: 168 },
        { id: 'h', used: 90, limit: 100, resetAtMs: FUTURE, periodHours: 5 },
      ],
    };
    expect(resolveQuotaSortKey('kimi', quota, 'weekly', NOW)).toEqual(value(75));
    expect(resolveQuotaSortKey('kimi', quota, 'fiveHour', NOW)).toEqual(value(10));
    const onlyZero = { status: 'success', rows: [quota.rows[0]] };
    expect(resolveQuotaSortKey('kimi', onlyZero, 'weekly', NOW)).toEqual({ status: 'na' });
  });

  test('xai weekly counts, monthly is na', () => {
    const weekly = {
      status: 'success',
      billing: { periodType: 'weekly', usagePercent: 20, resetAtMs: FUTURE },
    };
    const monthly = {
      status: 'success',
      billing: { periodType: 'monthly', usagePercent: 20, resetAtMs: FUTURE },
    };
    expect(resolveQuotaSortKey('xai', weekly, 'weekly', NOW)).toEqual(value(80));
    expect(resolveQuotaSortKey('xai', weekly, 'fiveHour', NOW)).toEqual({ status: 'na' });
    expect(resolveQuotaSortKey('xai', monthly, 'weekly', NOW)).toEqual({ status: 'na' });
    expect(resolveQuotaSortKey('xai', { status: 'success', billing: null }, 'weekly', NOW)).toEqual(
      {
        status: 'na',
      }
    );
  });
});

describe('sortByQuotaKey', () => {
  interface Row {
    id: string;
    key: QuotaSortKey;
  }
  const rows: Row[] = [
    { id: 'na1', key: { status: 'na' } },
    { id: 'v50', key: value(50) },
    { id: 'miss1', key: { status: 'missing' } },
    { id: 'v10', key: value(10) },
    { id: 'v90', key: value(90) },
    { id: 'miss2', key: { status: 'missing' } },
    { id: 'na2', key: { status: 'na' } },
  ];
  const ids = (list: Row[]) => list.map((row) => row.id);

  test('ascending keeps missing then na at the bottom', () => {
    expect(ids(sortByQuotaKey(rows, (r) => r.key, 'asc'))).toEqual([
      'v10',
      'v50',
      'v90',
      'miss1',
      'miss2',
      'na1',
      'na2',
    ]);
  });

  test('descending keeps missing then na at the bottom', () => {
    expect(ids(sortByQuotaKey(rows, (r) => r.key, 'desc'))).toEqual([
      'v90',
      'v50',
      'v10',
      'miss1',
      'miss2',
      'na1',
      'na2',
    ]);
  });

  test('ties break by earlier reset, null last, then original index', () => {
    const tied: Row[] = [
      { id: 'null', key: value(50, null) },
      { id: 'late', key: value(50, FUTURE + 10) },
      { id: 'early', key: value(50, FUTURE) },
      { id: 'early2', key: value(50, FUTURE) },
    ];
    const expected = ['early', 'early2', 'late', 'null'];
    expect(ids(sortByQuotaKey(tied, (r) => r.key, 'asc'))).toEqual(expected);
    expect(ids(sortByQuotaKey(tied, (r) => r.key, 'desc'))).toEqual(expected);
  });

  test('returns a new array and leaves input untouched', () => {
    const input = [...rows];
    const out = sortByQuotaKey(input, (r) => r.key, 'asc');
    expect(out).not.toBe(input);
    expect(input).toEqual(rows);
  });
});

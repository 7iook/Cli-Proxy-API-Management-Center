import { describe, expect, test } from 'bun:test';
import {
  getQuotaCacheStorageKey,
  hydrateQuotaMaps,
  mergeFreshQuota,
  pruneQuotaCache,
  readQuotaCache,
  writeQuotaCache,
} from '../src/stores/quotaPersistence';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const claudeSuccess = {
  status: 'success',
  windows: [{ id: 'five_hour', label: '5h', usedPercent: 29, resetLabel: '' }],
  observedAt: '2026-10-22T21:05:00.000Z',
  error: 'x',
  token: 'secret',
};

describe('quota persistence', () => {
  test('stores only fresh success states, without errors or credential-like fields', () => {
    const snapshot = mergeFreshQuota(
      {},
      {
        claudeQuota: { 'a.json': claudeSuccess },
        codexQuota: { 'b.json': { status: 'error', windows: [], error: 'boom' } },
        kimiQuota: { 'c.json': { status: 'loading' } },
      },
      1000
    );
    const entry = snapshot.claudeQuota?.['a.json'];
    expect(entry?.cachedAt).toBe(Date.parse(claudeSuccess.observedAt));
    expect(entry?.state.token).toBeUndefined();
    expect(entry?.state.error).toBeUndefined();
    expect(snapshot.codexQuota).toBeUndefined();
    expect(snapshot.kimiQuota).toBeUndefined();
  });

  test('falls back to now when no observation time and ignores hydrated entries', () => {
    const fresh = mergeFreshQuota(
      {},
      { codexQuota: { b: { status: 'success', windows: [] } } },
      42
    );
    expect(fresh.codexQuota?.b.cachedAt).toBe(42);
    const same = mergeFreshQuota(fresh, {
      codexQuota: { b: { status: 'success', windows: [], cachedAt: 42 } },
    });
    expect(same).toBe(fresh);
  });

  test('failed refresh keeps the last cached entry', () => {
    const cached = mergeFreshQuota({}, { claudeQuota: { a: claudeSuccess } });
    const after = mergeFreshQuota(cached, { claudeQuota: { a: { status: 'error', windows: [] } } });
    expect(after.claudeQuota?.a.state.windows).toEqual(claudeSuccess.windows);
  });

  test('hydrates as labelled success states without overriding loaded ones', () => {
    const snapshot = mergeFreshQuota(
      {},
      {
        claudeQuota: { a: claudeSuccess, b: { ...claudeSuccess } },
      }
    );
    const live = { status: 'loading', windows: [] };
    const maps = hydrateQuotaMaps(snapshot, { claudeQuota: { b: live } });
    expect(maps.claudeQuota?.a).toMatchObject({ status: 'success', cachedAt: expect.any(Number) });
    expect(maps.claudeQuota?.b).toBe(live);
  });

  test('prunes entries of deleted files including auth_index-scoped keys', () => {
    const snapshot = mergeFreshQuota(
      {},
      {
        devinQuota: {
          'd.json\u00001': { status: 'success', windows: [] },
          'e.json': { status: 'success', windows: [] },
        },
      }
    );
    const pruned = pruneQuotaCache(snapshot, ['d.json']);
    expect(Object.keys(pruned.devinQuota ?? {})).toEqual(['e.json']);
  });

  test('storage is scoped per server and tolerates corrupt data', () => {
    const storage = memoryStorage();
    writeQuotaCache(storage, 'https://a.example/', { codexQuota: {} });
    expect(readQuotaCache(storage, 'https://a.example')).toEqual({ codexQuota: {} });
    expect(readQuotaCache(storage, 'https://b.example')).toEqual({});
    storage.setItem(getQuotaCacheStorageKey('https://c.example'), '{oops');
    expect(readQuotaCache(storage, 'https://c.example')).toEqual({});
  });
});

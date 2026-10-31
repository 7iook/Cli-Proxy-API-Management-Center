import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_PREFERENCES, mergePreferences } from '../src/features/preferences/schema';
import {
  PREFERENCES_CACHE_KEY,
  readLegacyPreferences,
  readPreferencesCache,
  writePreferencesCache,
} from '../src/features/preferences/storage';

const originalWindow = (globalThis as { window?: unknown }).window;

const makeStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
};

let local: ReturnType<typeof makeStorage>;
let session: ReturnType<typeof makeStorage>;

beforeEach(() => {
  local = makeStorage();
  session = makeStorage();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: local,
    sessionStorage: session,
  };
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('preferences cache', () => {
  test('round-trips the document and its unsynced paths', () => {
    const prefs = mergePreferences(DEFAULT_PREFERENCES, { display: { compact: true } });
    writePreferencesCache({ prefs, dirty: ['display.compact'] });
    expect(readPreferencesCache()).toEqual({ prefs, dirty: ['display.compact'] });
  });

  test('absent, malformed and non-object caches read as null; contents are normalized', () => {
    expect(readPreferencesCache()).toBeNull();
    local.setItem(PREFERENCES_CACHE_KEY, '{not json');
    expect(readPreferencesCache()).toBeNull();
    local.setItem(PREFERENCES_CACHE_KEY, '"x"');
    expect(readPreferencesCache()).toBeNull();
    local.setItem(
      PREFERENCES_CACHE_KEY,
      JSON.stringify({ prefs: { display: { compact: 'yes', maskEmail: true } }, dirty: ['a', 3] })
    );
    expect(readPreferencesCache()).toEqual({
      prefs: mergePreferences(DEFAULT_PREFERENCES, { display: { maskEmail: true } }),
      dirty: ['a'],
    });
  });

  test('a throwing storage never breaks reads or writes', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: broken,
      sessionStorage: broken,
    };
    expect(readPreferencesCache()).toBeNull();
    expect(() => writePreferencesCache({ prefs: DEFAULT_PREFERENCES, dirty: [] })).not.toThrow();
    expect(readLegacyPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('legacy storage migration', () => {
  test('reads the three legacy keys from their original storages', () => {
    local.setItem(
      'authFilesPage.uiState',
      JSON.stringify({ filter: 'codex', sortMode: 'weeklyDesc', groupFilter: 'g-1', search: 'x' })
    );
    local.setItem('authFilesPage.compactMode', 'true');
    session.setItem('quotaPage.uiState', JSON.stringify({ tab: 'claude', sortMode: 'soonest' }));
    const prefs = readLegacyPreferences();
    expect(prefs.authFiles).toMatchObject({
      providerFilter: 'codex',
      sort: { field: 'weekly', direction: 'desc' },
      groupFilter: 'g-1',
    });
    expect(prefs.quota).toMatchObject({ tab: 'claude', sort: { field: 'soonest' } });
    expect(prefs.display.compact).toBe(true);
  });

  test('state written by builds that kept it in sessionStorage still migrates', () => {
    session.setItem('authFilesPage.uiState', JSON.stringify({ sortMode: 'priority' }));
    expect(readLegacyPreferences().authFiles.sort).toEqual({
      field: 'priority',
      direction: 'desc',
    });
  });

  test('nothing stored gives the defaults', () => {
    expect(readLegacyPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

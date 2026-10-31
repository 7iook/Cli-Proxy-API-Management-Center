import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  AUTH_FILES_SORT_MODES,
  isAuthFilesSortMode,
  readAuthFilesUiState,
  writeAuthFilesUiState,
} from '../src/features/authFiles/uiState';

const KEY = 'authFilesPage.uiState';
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

beforeEach(() => {
  local = makeStorage();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: local,
    sessionStorage: makeStorage(),
  };
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('auth files ui state', () => {
  test('previously persisted sort modes stay valid and new modes are accepted', () => {
    ['default', 'az', 'priority'].forEach((mode) => expect(isAuthFilesSortMode(mode)).toBe(true));
    ['custom', 'fiveHourAsc', 'fiveHourDesc', 'weeklyAsc', 'weeklyDesc'].forEach((mode) =>
      expect(AUTH_FILES_SORT_MODES).toContain(mode as (typeof AUTH_FILES_SORT_MODES)[number])
    );
    expect(isAuthFilesSortMode('bogus')).toBe(false);
  });

  test('state saved before groups existed reads back without a group filter', () => {
    local.setItem(KEY, JSON.stringify({ filter: 'codex', sortMode: 'priority', page: 2 }));
    const state = readAuthFilesUiState();
    expect(state?.sortMode).toBe('priority');
    expect(state?.groupFilter).toBeUndefined();
  });

  test('round-trips the group filter and a new sort mode', () => {
    writeAuthFilesUiState({ sortMode: 'weeklyAsc', groupFilter: 'g-1' });
    expect(readAuthFilesUiState()).toEqual({ sortMode: 'weeklyAsc', groupFilter: 'g-1' });
  });
});

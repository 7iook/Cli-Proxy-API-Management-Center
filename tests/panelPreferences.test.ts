import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PREFERENCES,
  diffPreferencePaths,
  mergePreferences,
  migrateLegacyAuthFilesSortMode,
  migrateLegacyPreferences,
  migrateLegacyQuotaSortMode,
  normalizePreferences,
  reapplyPreferencePaths,
} from '../src/features/preferences/schema';

describe('normalizePreferences', () => {
  test('non-objects and empty documents become the defaults', () => {
    for (const input of [null, undefined, 'x', 3, [], {}]) {
      expect(normalizePreferences(input)).toEqual(DEFAULT_PREFERENCES);
    }
  });

  test('drops unknown keys, replaces invalid values and fills missing sections', () => {
    const result = normalizePreferences({
      version: 7,
      extra: true,
      authFiles: {
        sort: { field: 'bogus', direction: 'sideways' },
        providerFilter: '  codex ',
        statusFilter: 'nope',
        regularPageSize: 999,
        compactPageSize: 'x',
        unknown: 1,
      },
      quota: { sort: { field: 'soonest' }, tab: 'not-a-tab' },
      display: { compact: 'yes', maskEmail: true },
    });
    expect(result).toEqual({
      version: 1,
      authFiles: {
        ...DEFAULT_PREFERENCES.authFiles,
        providerFilter: 'codex',
        regularPageSize: 30,
      },
      quota: { sort: { field: 'soonest', direction: 'asc' }, tab: 'all', groupFilter: 'all' },
      display: { compact: false, maskEmail: true },
    });
  });

  test('accepts every contract field and keeps priority high-first when direction is absent', () => {
    expect(
      normalizePreferences({ authFiles: { sort: { field: 'priority' } } }).authFiles.sort
    ).toEqual({ field: 'priority', direction: 'desc' });
    expect(
      normalizePreferences({ authFiles: { sort: { field: 'weeklyReset', direction: 'desc' } } })
        .authFiles.sort
    ).toEqual({ field: 'weeklyReset', direction: 'desc' });
    expect(normalizePreferences({ quota: { tab: 'devin' } }).quota.tab).toBe('devin');
  });
});

describe('legacy sort mode migration', () => {
  test('auth files modes map to field and direction', () => {
    const expected: Record<string, [string, string]> = {
      default: ['default', 'asc'],
      az: ['az', 'asc'],
      priority: ['priority', 'desc'],
      custom: ['custom', 'asc'],
      fiveHourAsc: ['fiveHour', 'asc'],
      fiveHourDesc: ['fiveHour', 'desc'],
      weeklyAsc: ['weekly', 'asc'],
      weeklyDesc: ['weekly', 'desc'],
    };
    for (const [mode, [field, direction]] of Object.entries(expected)) {
      expect(migrateLegacyAuthFilesSortMode(mode)).toEqual({ field, direction });
    }
    expect(migrateLegacyAuthFilesSortMode('soonest')).toBeNull();
    expect(migrateLegacyAuthFilesSortMode(5)).toBeNull();
  });

  test('quota modes map to field and direction', () => {
    expect(migrateLegacyQuotaSortMode('soonest')).toEqual({ field: 'soonest', direction: 'asc' });
    expect(migrateLegacyQuotaSortMode('weeklyDesc')).toEqual({
      field: 'weekly',
      direction: 'desc',
    });
    expect(migrateLegacyQuotaSortMode('az')).toBeNull();
    expect(migrateLegacyQuotaSortMode('toString')).toBeNull();
  });
});

describe('migrateLegacyPreferences', () => {
  test('carries over filters, page sizes, sort and compact mode', () => {
    const result = migrateLegacyPreferences({
      authFilesUiState: {
        filter: 'Codex',
        statusFilterMode: 'disabledProblem',
        compactMode: false,
        search: 'secret',
        page: 4,
        regularPageSize: 6,
        compactPageSize: 18,
        sortMode: 'priority',
        groupFilter: 'g-1',
      },
      authFilesCompactMode: true,
      quotaUiState: { tab: 'claude', sortMode: 'fiveHourAsc', groupFilter: 'ungrouped' },
    });
    expect(result.authFiles).toEqual({
      sort: { field: 'priority', direction: 'desc' },
      providerFilter: 'codex',
      statusFilter: 'problem',
      groupFilter: 'g-1',
      regularPageSize: 6,
      compactPageSize: 18,
    });
    expect(result.quota).toEqual({
      sort: { field: 'fiveHour', direction: 'asc' },
      tab: 'claude',
      groupFilter: 'ungrouped',
    });
    expect(result.display).toEqual({ compact: true, maskEmail: false });
  });

  test('older state shapes: single page size, boolean status flags, compact inside uiState', () => {
    const result = migrateLegacyPreferences({
      authFilesUiState: { pageSize: 15, problemOnly: true, compactMode: true },
    });
    expect(result.authFiles.regularPageSize).toBe(15);
    expect(result.authFiles.compactPageSize).toBe(15);
    expect(result.authFiles.statusFilter).toBe('problem');
    expect(result.display.compact).toBe(true);
    expect(
      migrateLegacyPreferences({ authFilesUiState: { disabledOnly: true } }).authFiles.statusFilter
    ).toBe('disabled');
  });

  test('missing or garbage inputs give the defaults', () => {
    expect(migrateLegacyPreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect(
      migrateLegacyPreferences({
        authFilesUiState: 'x',
        quotaUiState: 7,
        authFilesCompactMode: 'y',
      })
    ).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('dirty path merge', () => {
  test('mergePreferences applies a section patch and diff reports leaf paths', () => {
    const next = mergePreferences(DEFAULT_PREFERENCES, {
      authFiles: { sort: { field: 'weekly', direction: 'desc' } },
      display: { maskEmail: true },
    });
    expect(diffPreferencePaths(DEFAULT_PREFERENCES, next).sort()).toEqual([
      'authFiles.sort.direction',
      'authFiles.sort.field',
      'display.maskEmail',
    ]);
    expect(diffPreferencePaths(next, next)).toEqual([]);
  });

  test('reapply lays only the dirty local paths over the server document', () => {
    const server = mergePreferences(DEFAULT_PREFERENCES, {
      authFiles: { providerFilter: 'claude', regularPageSize: 12 },
      display: { compact: true },
    });
    const local = mergePreferences(DEFAULT_PREFERENCES, {
      authFiles: { providerFilter: 'codex' },
      display: { maskEmail: true },
    });
    const merged = reapplyPreferencePaths(server, local, [
      'authFiles.providerFilter',
      'display.maskEmail',
    ]);
    expect(merged.authFiles.providerFilter).toBe('codex');
    expect(merged.display).toEqual({ compact: true, maskEmail: true });
    expect(merged.authFiles.regularPageSize).toBe(12);
  });
});

import { describe, expect, test } from 'bun:test';
import {
  countFilesByGroup,
  draftsFromGroups,
  draftsToGroups,
  filterFilesByGroup,
  moveDraft,
  normalizeGroupFilter,
  removedGroupIds,
  validateGroupDrafts,
  withUiMeta,
  MAX_ACCOUNT_GROUPS,
  type GroupDraft,
} from '../src/features/accountGroups/logic';
import type { AccountGroup } from '../src/services/api/accountGroups';
import type { AuthFileItem } from '../src/types';

const groups: AccountGroup[] = [
  { id: 'g-pro', name: 'Pro', color: '#7C3AED' },
  { id: 'g-free', name: 'Free' },
];

const file = (name: string, group?: string, order?: number): AuthFileItem => ({
  name,
  ...(group !== undefined || order !== undefined
    ? {
        ui: {
          ...(group !== undefined ? { group } : {}),
          ...(order !== undefined ? { order } : {}),
        },
      }
    : {}),
});

const files = [
  file('a.json', 'g-pro'),
  file('b.json', 'g-free'),
  file('c.json'),
  file('d.json', 'g-deleted'),
];

describe('filterFilesByGroup', () => {
  test('all keeps every file', () => {
    expect(filterFilesByGroup(files, 'all', groups).map((f) => f.name)).toEqual([
      'a.json',
      'b.json',
      'c.json',
      'd.json',
    ]);
  });

  test('ungrouped includes files pointing at unknown group ids', () => {
    expect(filterFilesByGroup(files, 'ungrouped', groups).map((f) => f.name)).toEqual([
      'c.json',
      'd.json',
    ]);
  });

  test('a group id keeps only its members; an unknown id matches nothing', () => {
    expect(filterFilesByGroup(files, 'g-pro', groups).map((f) => f.name)).toEqual(['a.json']);
    expect(filterFilesByGroup(files, 'g-gone', groups)).toEqual([]);
  });
});

describe('countFilesByGroup', () => {
  test('counts members, ungrouped and unknown references', () => {
    expect(countFilesByGroup(files, groups)).toEqual({
      all: 4,
      ungrouped: 2,
      byId: { 'g-pro': 1, 'g-free': 1 },
    });
  });
});

describe('normalizeGroupFilter', () => {
  test('keeps built-in and known filters, falls back to all otherwise', () => {
    expect(normalizeGroupFilter('all', groups)).toBe('all');
    expect(normalizeGroupFilter('ungrouped', groups)).toBe('ungrouped');
    expect(normalizeGroupFilter('g-pro', groups)).toBe('g-pro');
    expect(normalizeGroupFilter('g-gone', groups)).toBe('all');
  });
});

describe('validateGroupDrafts', () => {
  const draft = (key: string, name: string, color?: string): GroupDraft => ({
    key,
    id: '',
    name,
    color,
  });

  test('flags empty, too long and invalid colors', () => {
    const { errors } = validateGroupDrafts([
      draft('a', '  '),
      draft('b', 'x'.repeat(65)),
      draft('c', 'ok', 'red'),
      draft('d', 'fine', '#aabbcc'),
    ]);
    expect(errors).toEqual({ a: 'empty', b: 'too_long', c: 'color' });
  });

  test('counts runes, not UTF-16 units', () => {
    expect(validateGroupDrafts([draft('a', '😀'.repeat(64))]).errors).toEqual({});
  });

  test('duplicate names are case-insensitive and flag both rows', () => {
    const { errors } = validateGroupDrafts([
      draft('a', 'Pro'),
      draft('b', ' pro '),
      draft('c', 'x'),
    ]);
    expect(errors).toEqual({ a: 'duplicate', b: 'duplicate' });
  });

  test('rejects more than the maximum number of groups', () => {
    const many = Array.from({ length: MAX_ACCOUNT_GROUPS + 1 }, (_, i) => draft(`k${i}`, `g${i}`));
    expect(validateGroupDrafts(many).tooMany).toBe(true);
    expect(validateGroupDrafts(many.slice(0, MAX_ACCOUNT_GROUPS)).tooMany).toBe(false);
  });
});

describe('draft helpers', () => {
  test('round-trips groups and trims names', () => {
    const drafts = draftsFromGroups(groups);
    drafts[0] = { ...drafts[0], name: ' Pro+ ' };
    expect(draftsToGroups(drafts)).toEqual([
      { id: 'g-pro', name: 'Pro+', color: '#7C3AED' },
      { id: 'g-free', name: 'Free' },
    ]);
  });

  test('moveDraft swaps neighbours and ignores out-of-range moves', () => {
    expect(moveDraft([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveDraft([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveDraft([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  test('removedGroupIds lists ids missing after a save', () => {
    expect([...removedGroupIds(groups, [groups[0]])]).toEqual(['g-free']);
  });
});

describe('withUiMeta', () => {
  test('sets and removes keys, dropping ui when empty', () => {
    const grouped = withUiMeta(file('a.json'), { group: 'g-pro' });
    expect(grouped.ui).toEqual({ group: 'g-pro' });
    const ordered = withUiMeta(grouped, { order: 5 });
    expect(ordered.ui).toEqual({ group: 'g-pro', order: 5 });
    expect(withUiMeta(ordered, { group: undefined }).ui).toEqual({ order: 5 });
    expect('ui' in withUiMeta(grouped, { group: undefined })).toBe(false);
  });
});

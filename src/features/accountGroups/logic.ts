/**
 * Account group pure logic: filtering, counting, draft validation.
 * React-free —— 由 tests/accountGroupsLogic.test.ts 直接消费。
 * Groups are display-only; nothing here may influence scheduling.
 */

import type { AccountGroup } from '@/services/api/accountGroups';
import type { AuthFileItem } from '@/types';

export const GROUP_FILTER_ALL = 'all';
export const GROUP_FILTER_UNGROUPED = 'ungrouped';

export const MAX_ACCOUNT_GROUPS = 200;
export const MAX_GROUP_NAME_LENGTH = 64;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const GROUP_PRESET_COLORS = [
  '#7C3AED',
  '#2563EB',
  '#0891B2',
  '#059669',
  '#CA8A04',
  '#EA580C',
  '#DC2626',
  '#DB2777',
  '#64748B',
] as const;

/** The group id a file really belongs to; unknown ids count as ungrouped. */
export const resolveFileGroupId = (
  file: Pick<AuthFileItem, 'ui'>,
  groupIds: ReadonlySet<string>
): string | null => {
  const id = file.ui?.group;
  return typeof id === 'string' && groupIds.has(id) ? id : null;
};

export const getFileGroup = (
  file: Pick<AuthFileItem, 'ui'>,
  groups: readonly AccountGroup[]
): AccountGroup | null => {
  const id = file.ui?.group;
  return typeof id === 'string' ? (groups.find((group) => group.id === id) ?? null) : null;
};

/** Falls back to 'all' when the persisted filter references a group that is gone. */
export const normalizeGroupFilter = (filter: string, groups: readonly AccountGroup[]): string => {
  if (filter === GROUP_FILTER_ALL || filter === GROUP_FILTER_UNGROUPED) return filter;
  return groups.some((group) => group.id === filter) ? filter : GROUP_FILTER_ALL;
};

export const filterFilesByGroup = <T extends Pick<AuthFileItem, 'ui'>>(
  files: readonly T[],
  filter: string,
  groups: readonly AccountGroup[]
): T[] => {
  if (filter === GROUP_FILTER_ALL) return [...files];
  const ids = new Set(groups.map((group) => group.id));
  return files.filter((file) => {
    const id = resolveFileGroupId(file, ids);
    return filter === GROUP_FILTER_UNGROUPED ? id === null : id === filter;
  });
};

export interface GroupCounts {
  all: number;
  ungrouped: number;
  byId: Record<string, number>;
}

export const countFilesByGroup = (
  files: readonly Pick<AuthFileItem, 'ui'>[],
  groups: readonly AccountGroup[]
): GroupCounts => {
  const ids = new Set(groups.map((group) => group.id));
  const counts: GroupCounts = { all: files.length, ungrouped: 0, byId: {} };
  groups.forEach((group) => {
    counts.byId[group.id] = 0;
  });
  files.forEach((file) => {
    const id = resolveFileGroupId(file, ids);
    if (id === null) counts.ungrouped += 1;
    else counts.byId[id] += 1;
  });
  return counts;
};

/* ---------- GroupManager drafts ---------- */

export interface GroupDraft {
  /** Local React key. */
  key: string;
  /** Server id; empty for groups that are not saved yet. */
  id: string;
  name: string;
  color?: string;
}

export type GroupDraftError = 'empty' | 'too_long' | 'duplicate' | 'color';

export const draftsFromGroups = (groups: readonly AccountGroup[]): GroupDraft[] =>
  groups.map((group) => ({ key: group.id, ...group }));

export const draftsToGroups = (drafts: readonly GroupDraft[]) =>
  drafts.map((draft) => ({
    id: draft.id,
    name: draft.name.trim(),
    ...(draft.color ? { color: draft.color } : {}),
  }));

/** Per-draft validation mirroring the backend (name 1..64 runes, case-insensitive unique, max 200). */
export const validateGroupDrafts = (
  drafts: readonly GroupDraft[]
): { errors: Record<string, GroupDraftError>; tooMany: boolean } => {
  const errors: Record<string, GroupDraftError> = {};
  const seen = new Map<string, string>();
  drafts.forEach((draft) => {
    const name = draft.name.trim();
    if (!name) {
      errors[draft.key] = 'empty';
    } else if ([...name].length > MAX_GROUP_NAME_LENGTH) {
      errors[draft.key] = 'too_long';
    } else if (draft.color && !COLOR_PATTERN.test(draft.color)) {
      errors[draft.key] = 'color';
    } else {
      const lowered = name.toLowerCase();
      const first = seen.get(lowered);
      if (first !== undefined) {
        errors[draft.key] = 'duplicate';
        errors[first] = 'duplicate';
      } else {
        seen.set(lowered, draft.key);
      }
    }
  });
  return { errors, tooMany: drafts.length > MAX_ACCOUNT_GROUPS };
};

export const moveDraft = <T>(items: readonly T[], index: number, delta: -1 | 1): T[] => {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** Ids that existed before and are gone after a save. */
export const removedGroupIds = (
  before: readonly AccountGroup[],
  after: readonly AccountGroup[]
): Set<string> => {
  const kept = new Set(after.map((group) => group.id));
  return new Set(before.filter((group) => !kept.has(group.id)).map((group) => group.id));
};

/** Fallback colour for groups without one (neutral). */
export const DEFAULT_GROUP_COLOR = '#64748B';

/** Returns the file with `ui` patched; an undefined value removes that key. */
export const withUiMeta = (
  file: AuthFileItem,
  patch: { group?: string | undefined; order?: number | undefined }
): AuthFileItem => {
  const next: { group?: string; order?: number } = { ...file.ui };
  if ('group' in patch) {
    if (patch.group === undefined) delete next.group;
    else next.group = patch.group;
  }
  if ('order' in patch) {
    if (patch.order === undefined) delete next.order;
    else next.order = patch.order;
  }
  const { ui: _previous, ...rest } = file;
  void _previous;
  return Object.keys(next).length > 0 ? { ...rest, ui: next } : (rest as AuthFileItem);
};

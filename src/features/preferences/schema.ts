/**
 * Panel display preferences: types, defaults, tolerant normalization, legacy
 * migration and the path helpers the sync layer uses for field-level merges.
 *
 * Pure and React-free. The document shape is the backend contract (version 1);
 * it is purely presentational and never read by scheduling or account groups.
 */

import { clampCardPageSize, normalizeProviderKey } from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '@/features/quota/constants';

export const PREFERENCES_VERSION = 1;

export type SortDirection = 'asc' | 'desc';
export type SortSpec<F extends string> = { field: F; direction: SortDirection };

export const AUTH_FILES_SORT_FIELDS = [
  'default',
  'az',
  'priority',
  'fiveHour',
  'weekly',
  'weeklyReset',
  'custom',
] as const;
export const QUOTA_SORT_FIELDS = [
  'default',
  'soonest',
  'fiveHour',
  'weekly',
  'weeklyReset',
] as const;
export const AUTH_FILES_STATUS_FILTER_MODES = ['all', 'enabled', 'disabled', 'problem'] as const;

export type AuthFilesSortField = (typeof AUTH_FILES_SORT_FIELDS)[number];
export type QuotaSortField = (typeof QUOTA_SORT_FIELDS)[number];
export type AuthFilesSort = SortSpec<AuthFilesSortField>;
export type QuotaSort = SortSpec<QuotaSortField>;
export type AuthFilesStatusFilterMode = (typeof AUTH_FILES_STATUS_FILTER_MODES)[number];

/** Fields where direction means nothing; the control hides its direction button for them. */
const DIRECTIONLESS_FIELDS: ReadonlySet<string> = new Set(['default', 'custom', 'soonest']);
export const isDirectionalSortField = (field: string): boolean => !DIRECTIONLESS_FIELDS.has(field);

/** Direction a field starts in when picked: priority is high-first, everything else ascending. */
export const defaultDirectionFor = (field: string): SortDirection =>
  field === 'priority' ? 'desc' : 'asc';

export interface PanelPreferences {
  version: typeof PREFERENCES_VERSION;
  authFiles: {
    sort: AuthFilesSort;
    providerFilter: string;
    statusFilter: AuthFilesStatusFilterMode;
    /** 'all' | 'ungrouped' | group id */
    groupFilter: string;
    regularPageSize: number;
    compactPageSize: number;
  };
  quota: {
    sort: QuotaSort;
    tab: string;
    groupFilter: string;
  };
  display: {
    compact: boolean;
    maskEmail: boolean;
  };
}

export type PreferencesPatch = {
  [K in keyof Omit<PanelPreferences, 'version'>]?: Partial<PanelPreferences[K]>;
};

export const DEFAULT_REGULAR_PAGE_SIZE = 9;
export const DEFAULT_COMPACT_PAGE_SIZE = 12;

export const DEFAULT_PREFERENCES: PanelPreferences = {
  version: PREFERENCES_VERSION,
  authFiles: {
    sort: { field: 'default', direction: 'asc' },
    providerFilter: 'all',
    statusFilter: 'all',
    groupFilter: 'all',
    regularPageSize: DEFAULT_REGULAR_PAGE_SIZE,
    compactPageSize: DEFAULT_COMPACT_PAGE_SIZE,
  },
  quota: {
    sort: { field: 'default', direction: 'asc' },
    tab: 'all',
    groupFilter: 'all',
  },
  display: { compact: false, maskEmail: false },
};

const QUOTA_TABS: ReadonlySet<string> = new Set(['all', ...QUOTA_TAB_ORDER]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const pickOne = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const pickText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const pickBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const pickPageSize = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? clampCardPageSize(value) : fallback;

const pickSort = <F extends string>(
  value: unknown,
  fields: readonly F[],
  fallback: SortSpec<F>
): SortSpec<F> => {
  const record = isRecord(value) ? value : {};
  const field = pickOne(record.field, fields, fallback.field);
  return {
    field,
    direction: pickOne(
      record.direction,
      ['asc', 'desc'] as const,
      field === fallback.field ? fallback.direction : defaultDirectionFor(field)
    ),
  };
};

/** Tolerant: unknown keys are dropped, invalid values fall back, missing sections are filled. */
export function normalizePreferences(input: unknown): PanelPreferences {
  const root = isRecord(input) ? input : {};
  const authFiles = isRecord(root.authFiles) ? root.authFiles : {};
  const quota = isRecord(root.quota) ? root.quota : {};
  const display = isRecord(root.display) ? root.display : {};
  const d = DEFAULT_PREFERENCES;
  return {
    version: PREFERENCES_VERSION,
    authFiles: {
      sort: pickSort(authFiles.sort, AUTH_FILES_SORT_FIELDS, d.authFiles.sort),
      providerFilter: pickText(authFiles.providerFilter, d.authFiles.providerFilter),
      statusFilter: pickOne(
        authFiles.statusFilter,
        AUTH_FILES_STATUS_FILTER_MODES,
        d.authFiles.statusFilter
      ),
      groupFilter: pickText(authFiles.groupFilter, d.authFiles.groupFilter),
      regularPageSize: pickPageSize(authFiles.regularPageSize, d.authFiles.regularPageSize),
      compactPageSize: pickPageSize(authFiles.compactPageSize, d.authFiles.compactPageSize),
    },
    quota: {
      sort: pickSort(quota.sort, QUOTA_SORT_FIELDS, d.quota.sort),
      tab: typeof quota.tab === 'string' && QUOTA_TABS.has(quota.tab) ? quota.tab : d.quota.tab,
      groupFilter: pickText(quota.groupFilter, d.quota.groupFilter),
    },
    display: {
      compact: pickBool(display.compact, d.display.compact),
      maskEmail: pickBool(display.maskEmail, d.display.maskEmail),
    },
  };
}

/** Applies a section-level partial patch and re-normalizes the result. */
export function mergePreferences(
  prefs: PanelPreferences,
  patch: PreferencesPatch
): PanelPreferences {
  return normalizePreferences({
    ...prefs,
    authFiles: { ...prefs.authFiles, ...patch.authFiles },
    quota: { ...prefs.quota, ...patch.quota },
    display: { ...prefs.display, ...patch.display },
  });
}

/* ---------- Leaf paths: the unit of field-level last-writer-wins ---------- */

const collectLeaves = (value: unknown, prefix: string, out: Map<string, unknown>) => {
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) =>
      collectLeaves(child, prefix ? `${prefix}.${key}` : key, out)
    );
  } else {
    out.set(prefix, value);
  }
};

const leaves = (prefs: PanelPreferences): Map<string, unknown> => {
  const out = new Map<string, unknown>();
  collectLeaves(prefs, '', out);
  out.delete('version');
  return out;
};

/** Leaf paths whose value differs between two documents, e.g. `authFiles.sort.field`. */
export function diffPreferencePaths(before: PanelPreferences, after: PanelPreferences): string[] {
  const previous = leaves(before);
  return [...leaves(after)].flatMap(([path, value]) =>
    previous.get(path) === value ? [] : [path]
  );
}

export function getPreferenceAt(prefs: PanelPreferences, path: string): unknown {
  return leaves(prefs).get(path);
}

/** Lays the local values of `paths` on top of `base` (the server document). */
export function reapplyPreferencePaths(
  base: PanelPreferences,
  local: PanelPreferences,
  paths: Iterable<string>
): PanelPreferences {
  const draft = structuredClone(base) as unknown as Record<string, unknown>;
  for (const path of paths) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let node = draft;
    for (const key of keys) node = node[key] as Record<string, unknown>;
    if (node && typeof node === 'object') node[last] = getPreferenceAt(local, path);
  }
  return normalizePreferences(draft);
}

/* ---------- Legacy migration ---------- */

/** Raw values read from the pre-sync storage keys; every field is untrusted. */
export interface LegacyPreferenceInputs {
  /** `authFilesPage.uiState` (localStorage, or sessionStorage on older builds) */
  authFilesUiState?: unknown;
  /** `authFilesPage.compactMode` (localStorage) */
  authFilesCompactMode?: unknown;
  /** `quotaPage.uiState` (sessionStorage) */
  quotaUiState?: unknown;
}

const LEGACY_REMAINING_SORTS: Record<string, SortSpec<'fiveHour' | 'weekly'>> = {
  fiveHourAsc: { field: 'fiveHour', direction: 'asc' },
  fiveHourDesc: { field: 'fiveHour', direction: 'desc' },
  weeklyAsc: { field: 'weekly', direction: 'asc' },
  weeklyDesc: { field: 'weekly', direction: 'desc' },
};

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** Maps a pre-direction auth-files `sortMode` string; null when it is not a known mode. */
export function migrateLegacyAuthFilesSortMode(mode: unknown): AuthFilesSort | null {
  if (typeof mode !== 'string') return null;
  if (hasOwn(LEGACY_REMAINING_SORTS, mode)) return LEGACY_REMAINING_SORTS[mode];
  if (mode === 'az') return { field: 'az', direction: 'asc' };
  if (mode === 'priority') return { field: 'priority', direction: 'desc' };
  if (mode === 'default' || mode === 'custom') return { field: mode, direction: 'asc' };
  return null;
}

/** Maps a pre-direction quota-page `sortMode` string; null when it is not a known mode. */
export function migrateLegacyQuotaSortMode(mode: unknown): QuotaSort | null {
  if (typeof mode !== 'string') return null;
  if (hasOwn(LEGACY_REMAINING_SORTS, mode)) return LEGACY_REMAINING_SORTS[mode];
  if (mode === 'default' || mode === 'soonest') return { field: mode, direction: 'asc' };
  return null;
}

const legacyStatusFilter = (state: Record<string, unknown>): unknown => {
  if (state.statusFilterMode === 'disabledProblem') return 'problem';
  if (typeof state.statusFilterMode === 'string') return state.statusFilterMode;
  if (state.problemOnly === true) return 'problem';
  if (state.disabledOnly === true) return 'disabled';
  return undefined;
};

/** Builds a document from the old per-page storage keys, falling back to defaults. */
export function migrateLegacyPreferences(inputs: LegacyPreferenceInputs): PanelPreferences {
  const auth = isRecord(inputs.authFilesUiState) ? inputs.authFilesUiState : {};
  const quota = isRecord(inputs.quotaUiState) ? inputs.quotaUiState : {};
  // The dedicated compact key was written alongside, and wins over the one inside uiState.
  const compact =
    typeof inputs.authFilesCompactMode === 'boolean'
      ? inputs.authFilesCompactMode
      : auth.compactMode;
  const legacyPageSize = auth.pageSize;
  return normalizePreferences({
    authFiles: {
      sort: migrateLegacyAuthFilesSortMode(auth.sortMode) ?? undefined,
      providerFilter:
        typeof auth.filter === 'string' && auth.filter.trim()
          ? normalizeProviderKey(auth.filter)
          : undefined,
      statusFilter: legacyStatusFilter(auth),
      groupFilter: auth.groupFilter,
      regularPageSize: auth.regularPageSize ?? legacyPageSize,
      compactPageSize: auth.compactPageSize ?? legacyPageSize,
    },
    quota: {
      sort: migrateLegacyQuotaSortMode(quota.sortMode) ?? undefined,
      tab: quota.tab,
      groupFilter: quota.groupFilter,
    },
    display: { compact },
  });
}

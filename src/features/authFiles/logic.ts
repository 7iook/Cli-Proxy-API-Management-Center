/**
 * 认证文件列表纯逻辑：通配搜索、字段匹配、排序。
 * React-free —— 由 tests/authFilesListLogic.test.ts 直接消费。
 */

import type { AuthFileItem } from '@/types';
import { isPluginQuotaFile, resolveAuthProvider } from '@/utils/quota';
import {
  QUOTA_PROVIDER_TYPES,
  getAuthFileStatusMessage,
  normalizeProviderKey,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
} from './constants';
import { deriveAuthFileIdentity } from './identity';
import { sortByCustomOrder } from './customOrder';
import type { AuthFilesSort } from '@/features/preferences/schema';
import { getQuotaRankPlan } from '@/features/quota/constants';
import {
  resolveQuotaRank,
  sortByRankKey,
  type QuotaRankKey,
  type QuotaRankMetric,
  type QuotaWindowKind,
} from '@/features/quota/quotaSortKey';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { getQuotaCacheKey } from '@/utils/quota/identity';

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 不含 '*' 时返回 null（走 includes 路径）。刻意不加 ^/$ 锚点——保持子串语义。 */
export const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

/** “全部”展示每张受支持卡片自己的额度；指定提供商时只展示匹配的额度。 */
export const resolveAuthFileQuotaType = (
  file: AuthFileItem,
  filter: AuthFileQuotaFilter
): QuotaProviderType | null => {
  if (!filter) return null;

  const provider = resolveAuthProvider(file);
  if (isPluginQuotaFile(file)) {
    if (filter !== 'all' && filter !== 'plugin' && provider !== filter) return null;
    return 'plugin';
  }
  if (QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) {
    if (filter !== 'all' && provider !== filter) return null;
    return provider as QuotaProviderType;
  }

  return null;
};

/**
 * 搜索 haystack：文件名 + 类型 + 提供方 + 账号邮箱 + 项目 ID + 状态/错误信息 + 分组名。
 * 显式不含 account —— api-key 凭证的 account 就是 API key 本身，见 identity.ts。
 */
export const matchesAuthFileSearch = (
  file: AuthFileItem,
  term: string,
  wildcard: RegExp | null,
  groupName?: string
): boolean => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [
    file.name,
    file.type,
    file.provider,
    file.email,
    file.projectId,
    getAuthFileStatusMessage(file),
    groupName,
  ].some((value) => {
    const content = (value || '').toString();
    return wildcard ? wildcard.test(content) : content.toLowerCase().includes(needle);
  });
};

type QuotaRankPlan = { kind: QuotaWindowKind; metric: QuotaRankMetric };

export type AuthFileQuotaRankResolver = (file: AuthFileItem, plan: QuotaRankPlan) => QuotaRankKey;

/**
 * Builds the quota rank resolver for sorting. `nowMs` and the quota lookup are
 * injected so the caller decides when to re-sort (data change, not clock ticks).
 */
export const createAuthFileQuotaRankResolver =
  (
    getQuota: (type: QuotaProviderType, cacheKey: string) => unknown,
    nowMs: number
  ): AuthFileQuotaRankResolver =>
  (file, plan) => {
    const type = resolveAuthFileQuotaType(file, 'all');
    const quota = type ? getQuota(type, getQuotaCacheKey(file)) : undefined;
    return resolveQuotaRank(type, quota, plan, nowMs);
  };

/**
 * 返回新数组，不改动入参。未知 field 原序返回拷贝。
 * 额度字段需要注入 resolveQuotaRank；缺失时退化为 default 序。
 * Direction: az asc = A→Z; priority desc = high first; quota fields asc = least
 * remaining / soonest reset first. default and custom ignore it.
 */
export const sortAuthFiles = (
  files: AuthFileItem[],
  sort: AuthFilesSort,
  resolveQuotaRank?: AuthFileQuotaRankResolver
): AuthFileItem[] => {
  const { field, direction } = sort;
  const plan = getQuotaRankPlan(field);
  if (field === 'custom' || plan) {
    // Both are layered over the default order, so ties and unranked items stay deterministic.
    const base = sortAuthFiles(files, { field: 'default', direction: 'asc' });
    if (field === 'custom') {
      return sortByCustomOrder(
        base.map((file) => ({ file, name: file.name, order: file.ui?.order }))
      ).map((entry) => entry.file);
    }
    if (!resolveQuotaRank || !plan) return base;
    return sortByRankKey(base, (file) => resolveQuotaRank(file, plan), direction);
  }

  const copy = [...files];
  const sign = direction === 'asc' ? 1 : -1;
  if (field === 'default') {
    copy.sort((a, b) => {
      const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
      const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
      const providerCompare = providerA.localeCompare(providerB);
      if (providerCompare !== 0) return providerCompare;
      return a.name.localeCompare(b.name);
    });
  } else if (field === 'az') {
    // 按卡片主行排（有账号时即 email），所见即所排；同值用文件名决胜。
    // 装饰一次，避免在比较器里重复派生。
    const keys = new Map(copy.map((file) => [file, deriveAuthFileIdentity(file).primary]));
    copy.sort(
      (a, b) =>
        sign * (keys.get(a) ?? '').localeCompare(keys.get(b) ?? '') || a.name.localeCompare(b.name)
    );
  } else if (field === 'priority') {
    copy.sort((a, b) => {
      const pa = typeof a.priority === 'number' ? a.priority : 0;
      const pb = typeof b.priority === 'number' ? b.priority : 0;
      return sign * (pa - pb);
    });
  }
  return copy;
};

/**
 * Quota-capable files whose rank key is 'missing' (not loaded, loading or failed)
 * under the active quota sort. Empty for non-quota sorts.
 */
export const collectMissingQuotaEntries = (
  files: AuthFileItem[],
  sort: AuthFilesSort,
  resolveQuotaRank: AuthFileQuotaRankResolver
): QuotaFileEntry[] => {
  const plan = getQuotaRankPlan(sort.field);
  if (!plan) return [];
  return files.flatMap((file) => {
    const type = resolveAuthFileQuotaType(file, 'all');
    return type && resolveQuotaRank(file, plan).status === 'missing' ? [{ file, type }] : [];
  });
};

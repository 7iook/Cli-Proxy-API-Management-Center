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
import type { AuthFilesSortMode } from './uiState';
import { getQuotaRemainingSortSpec } from '@/features/quota/constants';
import {
  resolveQuotaSortKey,
  sortByQuotaKey,
  type QuotaSortKey,
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

export type AuthFileQuotaKeyResolver = (file: AuthFileItem, kind: QuotaWindowKind) => QuotaSortKey;

/**
 * Builds the quota key resolver for sorting. `nowMs` and the quota lookup are
 * injected so the caller decides when to re-sort (data change, not clock ticks).
 */
export const createAuthFileQuotaKeyResolver =
  (
    getQuota: (type: QuotaProviderType, cacheKey: string) => unknown,
    nowMs: number
  ): AuthFileQuotaKeyResolver =>
  (file, kind) => {
    const type = resolveAuthFileQuotaType(file, 'all');
    const quota = type ? getQuota(type, getQuotaCacheKey(file)) : undefined;
    return resolveQuotaSortKey(type, quota, kind, nowMs);
  };

/**
 * 返回新数组，不改动入参。未知 mode 原序返回拷贝。
 * 额度模式需要注入 resolveQuotaKey；缺失时退化为 default 序。
 */
export const sortAuthFiles = (
  files: AuthFileItem[],
  mode: AuthFilesSortMode,
  resolveQuotaKey?: AuthFileQuotaKeyResolver
): AuthFileItem[] => {
  const quotaSpec = getQuotaRemainingSortSpec(mode);
  if (mode === 'custom' || quotaSpec) {
    // Both are layered over the default order, so ties and unranked items stay deterministic.
    const base = sortAuthFiles(files, 'default');
    if (mode === 'custom') {
      return sortByCustomOrder(
        base.map((file) => ({ file, name: file.name, order: file.ui?.order }))
      ).map((entry) => entry.file);
    }
    if (!resolveQuotaKey || !quotaSpec) return base;
    return sortByQuotaKey(
      base,
      (file) => resolveQuotaKey(file, quotaSpec.kind),
      quotaSpec.direction
    );
  }

  const copy = [...files];
  if (mode === 'default') {
    copy.sort((a, b) => {
      const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
      const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
      const providerCompare = providerA.localeCompare(providerB);
      if (providerCompare !== 0) return providerCompare;
      return a.name.localeCompare(b.name);
    });
  } else if (mode === 'az') {
    // 按卡片主行排（有账号时即 email），所见即所排；同值用文件名决胜。
    // 装饰一次，避免在比较器里重复派生。
    const keys = new Map(copy.map((file) => [file, deriveAuthFileIdentity(file).primary]));
    copy.sort(
      (a, b) => (keys.get(a) ?? '').localeCompare(keys.get(b) ?? '') || a.name.localeCompare(b.name)
    );
  } else if (mode === 'priority') {
    copy.sort((a, b) => {
      const pa = typeof a.priority === 'number' ? a.priority : 0;
      const pb = typeof b.priority === 'number' ? b.priority : 0;
      return pb - pa; // 高优先级排前面
    });
  }
  return copy;
};

/**
 * Quota-capable files whose sort key is 'missing' (not loaded, loading or failed)
 * under the active quota sort mode. Empty for non-quota modes.
 */
export const collectMissingQuotaEntries = (
  files: AuthFileItem[],
  mode: AuthFilesSortMode,
  resolveQuotaKey: AuthFileQuotaKeyResolver
): QuotaFileEntry[] => {
  const spec = getQuotaRemainingSortSpec(mode);
  if (!spec) return [];
  return files.flatMap((file) => {
    const type = resolveAuthFileQuotaType(file, 'all');
    return type && resolveQuotaKey(file, spec.kind).status === 'missing' ? [{ file, type }] : [];
  });
};

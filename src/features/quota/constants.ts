import type { QuotaProviderType } from './providers/types';
import type { QuotaSortDirection, QuotaWindowKind } from './quotaSortKey';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** 页级分页固定 20/页，同时把「刷新全部」的上游并发限制在 20。 */
export const QUOTA_PAGE_SIZE = 20;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先；其余按 5h/周剩余额度。 */
export const QUOTA_SORT_MODES = [
  'default',
  'soonest',
  'fiveHourAsc',
  'fiveHourDesc',
  'weeklyAsc',
  'weeklyDesc',
] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Sort modes that order by remaining quota; shared by the quota and auth-files pages. */
export const QUOTA_REMAINING_SORT_SPECS = {
  fiveHourAsc: { kind: 'fiveHour', direction: 'asc' },
  fiveHourDesc: { kind: 'fiveHour', direction: 'desc' },
  weeklyAsc: { kind: 'weekly', direction: 'asc' },
  weeklyDesc: { kind: 'weekly', direction: 'desc' },
} as const satisfies Record<string, { kind: QuotaWindowKind; direction: QuotaSortDirection }>;

export const getQuotaRemainingSortSpec = (
  mode: string
): { kind: QuotaWindowKind; direction: QuotaSortDirection } | null =>
  Object.prototype.hasOwnProperty.call(QUOTA_REMAINING_SORT_SPECS, mode)
    ? QUOTA_REMAINING_SORT_SPECS[mode as keyof typeof QUOTA_REMAINING_SORT_SPECS]
    : null;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;

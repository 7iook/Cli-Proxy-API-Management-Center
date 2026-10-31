import type { QuotaProviderType } from './providers/types';
import type { QuotaRankMetric, QuotaWindowKind } from './quotaSortKey';

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

/** Quota-ranked sort fields on both pages; `weeklyReset` orders by the next weekly reset. */
const QUOTA_RANK_PLANS = {
  fiveHour: { kind: 'fiveHour', metric: 'remaining' },
  weekly: { kind: 'weekly', metric: 'remaining' },
  weeklyReset: { kind: 'weekly', metric: 'reset' },
} as const satisfies Record<string, { kind: QuotaWindowKind; metric: QuotaRankMetric }>;

export const getQuotaRankPlan = (
  field: string
): { kind: QuotaWindowKind; metric: QuotaRankMetric } | null =>
  Object.prototype.hasOwnProperty.call(QUOTA_RANK_PLANS, field)
    ? QUOTA_RANK_PLANS[field as keyof typeof QUOTA_RANK_PLANS]
    : null;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;

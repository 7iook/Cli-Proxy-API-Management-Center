/**
 * Manual credential ordering with sparse ranks, stored per credential as
 * `ui.order`. Ranks are spaced by ORDER_STEP so a move usually rewrites a
 * single credential; pure functions, no React or store.
 */

export const ORDER_STEP = 1024;

/** Neighbour gaps below this are renormalized instead of bisected. */
const MIN_GAP = 1e-6;

export interface OrderedItem {
  name: string;
  order?: number | null;
}

export interface OrderWrite {
  name: string;
  order: number;
}

const hasRank = (item: OrderedItem): boolean =>
  typeof item.order === 'number' && Number.isFinite(item.order);

const rankOf = (item: OrderedItem): number => item.order as number;

/** Items with a finite order first (ascending, tie by incoming index), then the rest in incoming order. */
export function sortByCustomOrder<T extends OrderedItem>(items: readonly T[]): T[] {
  const ranked = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => hasRank(item))
    .sort((a, b) => rankOf(a.item) - rankOf(b.item) || a.index - b.index)
    .map(({ item }) => item);
  return [...ranked, ...items.filter((item) => !hasRank(item))];
}

const maxRank = (items: readonly OrderedItem[]): number =>
  items.reduce((max, item) => (hasRank(item) ? Math.max(max, rankOf(item)) : max), 0);

const minRank = (items: readonly OrderedItem[]): number => {
  const ranks = items.filter(hasRank).map(rankOf);
  return ranks.length > 0 ? Math.min(...ranks) : 0;
};

/** Keeps only writes that change an item's current order. */
const diffWrites = (
  current: readonly OrderedItem[],
  next: ReadonlyMap<string, number>
): OrderWrite[] => {
  const writes: OrderWrite[] = [];
  for (const item of current) {
    const order = next.get(item.name);
    if (order === undefined) continue;
    if (hasRank(item) && rankOf(item) === order) continue;
    writes.push({ name: item.name, order });
  }
  return writes;
};

export function planMove<T extends OrderedItem>(
  sorted: readonly T[],
  fromIndex: number,
  toIndex: number
): OrderWrite[] {
  if (sorted.length < 2) return [];
  const clamp = (index: number) => Math.min(sorted.length - 1, Math.max(0, Math.trunc(index)));
  const from = clamp(fromIndex);
  const to = clamp(toIndex);
  if (from === to) return [];

  const moved = sorted[from];
  const next = sorted.filter((_, index) => index !== from);
  next.splice(to, 0, moved);

  const assigned = new Map<string, number>();

  // Unranked items at or before the target must be ranked so the order is deterministic.
  let firstUnranked = -1;
  for (let i = 0; i <= to; i += 1) {
    if (next[i] !== moved && !hasRank(next[i])) {
      firstUnranked = i;
      break;
    }
  }

  if (firstUnranked >= 0) {
    let rank = maxRank(next.filter((item) => item !== moved));
    for (let i = firstUnranked; i <= to; i += 1) {
      rank += ORDER_STEP;
      assigned.set(next[i].name, rank);
    }
    return diffWrites(sorted, assigned);
  }

  const prev = to > 0 ? next[to - 1] : null;
  const following = to < next.length - 1 ? next[to + 1] : null;
  const followingRanked = following !== null && hasRank(following);

  if (prev === null) {
    const rest = next.slice(1);
    assigned.set(moved.name, (followingRanked ? rankOf(following) : minRank(rest)) - ORDER_STEP);
  } else if (!followingRanked) {
    assigned.set(moved.name, rankOf(prev) + ORDER_STEP);
  } else if (rankOf(following) - rankOf(prev) >= MIN_GAP) {
    assigned.set(moved.name, (rankOf(prev) + rankOf(following)) / 2);
  } else {
    // Renormalize the whole ranked prefix (the moved item counts as ranked).
    let end = 0;
    while (end < next.length && (next[end] === moved || hasRank(next[end]))) end += 1;
    for (let i = 0; i < end; i += 1) assigned.set(next[i].name, i * ORDER_STEP);
  }

  return diffWrites(sorted, assigned);
}

export function planMoveToTop<T extends OrderedItem>(
  sorted: readonly T[],
  names: readonly string[]
): OrderWrite[] {
  const nameSet = new Set(names);
  const selected = sorted.filter((item) => nameSet.has(item.name));
  if (selected.length === 0) return [];
  // Already the leading block: nothing to do.
  if (selected.every((item, index) => sorted[index] === item)) return [];

  const rest = sorted.filter((item) => !nameSet.has(item.name));
  const base = minRank(rest) - selected.length * ORDER_STEP;
  const assigned = new Map<string, number>();
  selected.forEach((item, index) => assigned.set(item.name, base + index * ORDER_STEP));
  return diffWrites(sorted, assigned);
}

export function planMoveToBottom<T extends OrderedItem>(
  sorted: readonly T[],
  names: readonly string[]
): OrderWrite[] {
  const nameSet = new Set(names);
  const selected = sorted.filter((item) => nameSet.has(item.name));
  if (selected.length === 0) return [];
  const offset = sorted.length - selected.length;
  // Already the trailing block: nothing to do.
  if (selected.every((item, index) => sorted[offset + index] === item)) return [];

  const rest = sorted.filter((item) => !nameSet.has(item.name));
  let rank = maxRank(rest);
  const assigned = new Map<string, number>();
  // Unranked items ahead of the moved block need ranks to stay ahead of it.
  for (const item of [...rest.filter((entry) => !hasRank(entry)), ...selected]) {
    rank += ORDER_STEP;
    assigned.set(item.name, rank);
  }
  return diffWrites(sorted, assigned);
}

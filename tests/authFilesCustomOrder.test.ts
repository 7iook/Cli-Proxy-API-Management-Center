import { describe, expect, test } from 'bun:test';
import {
  ORDER_STEP,
  planMove,
  planMoveToBottom,
  planMoveToTop,
  sortByCustomOrder,
  type OrderedItem,
} from '@/features/authFiles/customOrder';

const item = (name: string, order?: number | null): OrderedItem => ({ name, order });
const names = (list: OrderedItem[]) => list.map((entry) => entry.name);

/** Applies writes then re-sorts, mimicking what the UI does after saving. */
const apply = (list: OrderedItem[], writes: { name: string; order: number }[]) => {
  const byName = new Map(writes.map((write) => [write.name, write.order]));
  return sortByCustomOrder(
    list.map((entry) =>
      byName.has(entry.name) ? { ...entry, order: byName.get(entry.name) } : entry
    )
  );
};

describe('sortByCustomOrder', () => {
  test('ranked first ascending, unranked keep incoming order', () => {
    const out = sortByCustomOrder([
      item('u1'),
      item('b', 20),
      item('u2', null),
      item('a', 10),
      item('c', Number.NaN),
      item('d', 20),
    ]);
    expect(names(out)).toEqual(['a', 'b', 'd', 'u1', 'u2', 'c']);
  });

  test('does not mutate input', () => {
    const input = [item('x'), item('y', 1)];
    sortByCustomOrder(input);
    expect(names(input)).toEqual(['x', 'y']);
  });
});

describe('planMove with ranked items', () => {
  const list = [item('a', 1000), item('b', 2000), item('c', 3000), item('d', 4000)];

  test('move down is a single midpoint write', () => {
    const writes = planMove(list, 0, 2);
    expect(writes).toEqual([{ name: 'a', order: 3500 }]);
    expect(names(apply(list, writes))).toEqual(['b', 'c', 'a', 'd']);
  });

  test('move up is a single midpoint write', () => {
    const writes = planMove(list, 3, 1);
    expect(writes).toEqual([{ name: 'd', order: 1500 }]);
    expect(names(apply(list, writes))).toEqual(['a', 'd', 'b', 'c']);
  });

  test('move to first uses min minus step', () => {
    const writes = planMove(list, 2, 0);
    expect(writes).toEqual([{ name: 'c', order: 1000 - ORDER_STEP }]);
    expect(names(apply(list, writes))).toEqual(['c', 'a', 'b', 'd']);
  });

  test('move to last uses max plus step', () => {
    const writes = planMove(list, 1, 3);
    expect(writes).toEqual([{ name: 'b', order: 4000 + ORDER_STEP }]);
    expect(names(apply(list, writes))).toEqual(['a', 'c', 'd', 'b']);
  });

  test('no-op and single item return empty', () => {
    expect(planMove(list, 1, 1)).toEqual([]);
    expect(planMove([item('a', 1)], 0, 0)).toEqual([]);
    expect(planMove([], 0, 3)).toEqual([]);
  });

  test('out-of-range indexes are clamped', () => {
    expect(planMove(list, 1, 99)).toEqual(planMove(list, 1, 3));
    expect(planMove(list, 2, -5)).toEqual(planMove(list, 2, 0));
    expect(planMove(list, 99, 0)).toEqual(planMove(list, 3, 0));
  });

  test('tiny gap renormalizes the ranked prefix and omits unchanged', () => {
    const tight = [item('a', 0), item('b', 5e-7), item('c', 1e-6), item('d', 4096)];
    const writes = planMove(tight, 3, 1);
    const result = apply(tight, writes);
    expect(names(result)).toEqual(['a', 'd', 'b', 'c']);
    // Result is spaced by ORDER_STEP; 'a' already sits at 0 and is omitted.
    expect(result.map((entry) => entry.order)).toEqual([0, 1, 2, 3].map((i) => i * ORDER_STEP));
    expect(writes.find((write) => write.name === 'a')).toBeUndefined();
    expect(writes.length).toBe(3);
  });

  test('equal neighbouring ranks renormalize', () => {
    const dup = [item('a', 10), item('b', 10), item('c', 50)];
    const writes = planMove(dup, 2, 1);
    expect(names(apply(dup, writes))).toEqual(['a', 'c', 'b']);
  });
});

describe('planMove with an unranked tail', () => {
  test('ranked item moved into the tail ranks the unranked items before it', () => {
    const list = [item('a', 100), item('b', 200), item('u1'), item('u2'), item('u3')];
    const writes = planMove(list, 0, 3);
    expect(writes).toEqual([
      { name: 'a', order: 200 + 3 * ORDER_STEP },
      { name: 'u1', order: 200 + ORDER_STEP },
      { name: 'u2', order: 200 + 2 * ORDER_STEP },
    ]);
    expect(names(apply(list, writes))).toEqual(['b', 'u1', 'u2', 'a', 'u3']);
  });

  test('unranked item moved up into the ranked prefix is a single midpoint write', () => {
    const list = [item('a', 100), item('b', 200), item('u1'), item('u2')];
    const writes = planMove(list, 3, 1);
    expect(writes).toEqual([{ name: 'u2', order: 150 }]);
    expect(names(apply(list, writes))).toEqual(['a', 'u2', 'b', 'u1']);
  });

  test('unranked item moved right after the prefix gets last plus step', () => {
    const list = [item('a', 100), item('u1'), item('u2')];
    const writes = planMove(list, 2, 1);
    expect(writes).toEqual([{ name: 'u2', order: 100 + ORDER_STEP }]);
    expect(names(apply(list, writes))).toEqual(['a', 'u2', 'u1']);
  });

  test('moving within the tail ranks everything up to the target', () => {
    const list = [item('a', 100), item('u1'), item('u2'), item('u3')];
    const writes = planMove(list, 3, 2);
    expect(names(apply(list, writes))).toEqual(['a', 'u1', 'u3', 'u2']);
    expect(writes.find((write) => write.name === 'u2')).toBeUndefined();
  });

  test('all unranked: moving down ranks the leading items deterministically', () => {
    const list = [item('x'), item('y'), item('z')];
    const writes = planMove(list, 0, 1);
    expect(writes).toEqual([
      { name: 'x', order: 2 * ORDER_STEP },
      { name: 'y', order: ORDER_STEP },
    ]);
    expect(names(apply(list, writes))).toEqual(['y', 'x', 'z']);
  });

  test('all unranked: moving to the top writes a single rank', () => {
    const list = [item('x'), item('y'), item('z')];
    const writes = planMove(list, 2, 0);
    expect(writes).toEqual([{ name: 'z', order: -ORDER_STEP }]);
    expect(names(apply(list, writes))).toEqual(['z', 'x', 'y']);
  });
});

describe('planMoveToTop / planMoveToBottom', () => {
  const list = [item('a', 100), item('b', 200), item('c', 300), item('u1'), item('u2')];

  test('top with a single name', () => {
    const writes = planMoveToTop(list, ['c']);
    expect(writes).toEqual([{ name: 'c', order: 100 - ORDER_STEP }]);
  });

  test('top with several names keeps their relative order', () => {
    const writes = planMoveToTop(list, ['u1', 'c', 'missing']);
    expect(names(apply(list, writes))).toEqual(['c', 'u1', 'a', 'b', 'u2']);
    expect(writes.length).toBe(2);
  });

  test('top is a no-op when already leading', () => {
    expect(planMoveToTop(list, ['a'])).toEqual([]);
    expect(planMoveToTop(list, ['b', 'a'])).toEqual([]);
    expect(planMoveToTop(list, [])).toEqual([]);
  });

  test('top on an all-unranked list', () => {
    const plain = [item('x'), item('y'), item('z')];
    const writes = planMoveToTop(plain, ['z', 'y']);
    expect(names(apply(plain, writes))).toEqual(['y', 'z', 'x']);
  });

  test('bottom ranks unranked items so the moved one stays last', () => {
    const writes = planMoveToBottom(list, ['a']);
    expect(names(apply(list, writes))).toEqual(['b', 'c', 'u1', 'u2', 'a']);
  });

  test('bottom with several names keeps relative order', () => {
    const writes = planMoveToBottom(list, ['b', 'a']);
    expect(names(apply(list, writes))).toEqual(['c', 'u1', 'u2', 'a', 'b']);
  });

  test('bottom on a fully ranked list is a single write', () => {
    const ranked = [item('a', 1), item('b', 2), item('c', 3)];
    expect(planMoveToBottom(ranked, ['a'])).toEqual([{ name: 'a', order: 3 + ORDER_STEP }]);
  });

  test('bottom is a no-op when already trailing', () => {
    expect(planMoveToBottom(list, ['u2'])).toEqual([]);
    expect(planMoveToBottom(list, ['u1', 'u2'])).toEqual([]);
    expect(planMoveToBottom(list, [])).toEqual([]);
  });
});

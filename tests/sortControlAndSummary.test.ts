import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { SortControl, type SortFieldOption } from '../src/components/common/SortControl';
import { QuotaSummaryRows } from '../src/features/quota/components/QuotaSummary';
import { summaryRemainingTone } from '../src/features/quota/components/quotaSummaryTone';

const noop = () => {};
const fields: Array<SortFieldOption<string>> = [
  { value: 'default', label: 'Default' },
  { value: 'weekly', label: 'Weekly', ascHint: 'least first', descHint: 'most first' },
];

const renderSort = (field: string, direction: 'asc' | 'desc') =>
  renderToStaticMarkup(
    createElement(SortControl<string>, {
      value: { field, direction },
      fields,
      onChange: noop,
      ariaLabel: 'Sort',
    })
  );

describe('SortControl', () => {
  test('hides the direction button for fields without direction', () => {
    expect(renderSort('default', 'asc')).not.toContain('aria-pressed');
  });

  test('describes the current order with the field-specific hint', () => {
    const asc = renderSort('weekly', 'asc');
    expect(asc).toContain('aria-pressed="false"');
    expect(asc).toContain(
      i18n.t('sort_control.direction_toggle', {
        order: `${i18n.t('sort_control.ascending')} · least first`,
      })
    );
    const desc = renderSort('weekly', 'desc');
    expect(desc).toContain('aria-pressed="true"');
    expect(desc).toContain(`${i18n.t('sort_control.descending')} · most first`);
  });
});

describe('QuotaSummaryRows', () => {
  const render = (quota: unknown) =>
    renderToStaticMarkup(createElement(QuotaSummaryRows, { type: 'codex', quota: quota as never }));
  const now = Date.now();
  const window = (id: string, usedPercent: number, periodHours: number, resetAtMs: number) => ({
    id,
    label: id,
    usedPercent,
    resetLabel: '',
    resetAtMs,
    periodHours,
  });

  test('shows remaining percent and reset for both windows', () => {
    const html = render({
      status: 'success',
      windows: [
        window('five-hour', 28, 5, now + 2 * 3_600_000),
        window('weekly', 60, 168, now + 3 * 86_400_000),
      ],
    });
    expect(html).toContain('72%');
    expect(html).toContain('40%');
    expect(html).toContain(i18n.t('quota_summary.five_hour'));
    expect(html).toContain(i18n.t('quota_summary.weekly'));
    // absolute reset instant (like the normal view) plus a relative phrase
    expect(html).toMatch(/\d{2}\/\d{2},? \d{2}:\d{2}/);
    expect(html).toMatch(/in 2 hours|2 小时后/);
  });

  test('a missing window renders a dash and unloaded states render messages', () => {
    const html = render({
      status: 'success',
      windows: [window('weekly', 10, 168, now + 86_400_000)],
    });
    expect(html).toContain('90%');
    expect(html).toContain('—');
    expect(render(undefined)).toContain(i18n.t('quota_summary.no_data'));
    expect(render({ status: 'loading' })).toContain(i18n.t('quota_summary.loading'));
    expect(render({ status: 'error' })).toContain(i18n.t('quota_summary.load_failed'));
  });

  test('renders a remaining-quota progress bar per window', () => {
    const html = render({
      status: 'success',
      windows: [
        window('five-hour', 28, 5, now + 2 * 3_600_000),
        window('weekly', 90, 168, now + 3 * 86_400_000),
      ],
    });
    expect(html.match(/role="progressbar"/g)?.length).toBe(2);
    expect(html).toContain('aria-valuenow="72"');
    expect(html).toContain('width:72%');
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('width:10%');
  });

  test('a missing window renders an empty bar without a value', () => {
    const html = render({
      status: 'success',
      windows: [window('weekly', 10, 168, now + 86_400_000)],
    });
    expect(html.match(/role="progressbar"/g)?.length).toBe(2);
    expect(html.match(/width:/g)?.length).toBe(1);
  });

  test('tone buckets follow remaining percent', () => {
    expect(summaryRemainingTone(100)).toBe('high');
    expect(summaryRemainingTone(51)).toBe('high');
    expect(summaryRemainingTone(50)).toBe('medium');
    expect(summaryRemainingTone(20)).toBe('medium');
    expect(summaryRemainingTone(19)).toBe('low');
    expect(summaryRemainingTone(0)).toBe('low');
  });
});

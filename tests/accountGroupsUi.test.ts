import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { GroupChipRow } from '../src/features/accountGroups/components/GroupChipRow';
import { GroupEditor } from '../src/features/accountGroups/components/GroupManager';
import type { GroupDraft } from '../src/features/accountGroups/logic';

const noop = () => {};

describe('account group UI smoke', () => {
  test('chip row renders all, ungrouped, groups with counts and the manage button', () => {
    const html = renderToStaticMarkup(
      createElement(GroupChipRow, {
        groups: [
          { id: 'g-1', name: 'Pro', color: '#7C3AED' },
          { id: 'g-2', name: 'Free' },
        ],
        counts: { all: 5, ungrouped: 1, byId: { 'g-1': 3, 'g-2': 1 } },
        active: 'g-1',
        onChange: noop,
        onManage: noop,
      })
    );
    expect(html).toContain('Pro');
    expect(html).toContain('Free');
    expect(html).toContain(i18n.t('account_groups.filter_all'));
    expect(html).toContain(i18n.t('account_groups.filter_ungrouped'));
    expect(html).toContain(i18n.t('account_groups.manage'));
    expect(html).toContain('background-color:#7C3AED');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  test('editor renders rows, validation errors and move/delete controls', () => {
    const drafts: GroupDraft[] = [
      { key: 'a', id: 'g-1', name: 'Pro', color: '#7C3AED' },
      { key: 'b', id: '', name: 'pro' },
    ];
    const html = renderToStaticMarkup(createElement(GroupEditor, { drafts, onChange: noop }));
    expect(html).toContain('type="color"');
    expect(html).toContain(i18n.t('account_groups.error_duplicate'));
    expect(html).toContain(i18n.t('account_groups.add'));
    expect(html.split(`aria-label="${i18n.t('account_groups.delete')}"`)).toHaveLength(3);
  });

  test('every locale defines the same account group keys with matching tokens', () => {
    const load = (lang: string) =>
      JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')) as Record<
        string,
        Record<string, string>
      >;
    const tokens = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');
    const en = load('en');
    const sections: Array<[string, (key: string) => boolean]> = [
      ['account_groups', () => true],
      [
        'auth_files',
        (key) =>
          /^(sort_(fiveHour|weekly|custom)|quota_sort_|group_assign_|order_|batch_group|batch_move_top|delete_disabled_group)/.test(
            key
          ),
      ],
      ['quota_management', (key) => /^sort_(fiveHour|weekly)/.test(key)],
    ];
    for (const lang of ['zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const other = load(lang);
      for (const [section, pick] of sections) {
        const keys = Object.keys(en[section]).filter(pick);
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
          expect(other[section]?.[key]).toBeTruthy();
          expect(tokens(other[section][key])).toBe(tokens(en[section][key]));
        }
      }
    }
  });
});

import { useTranslation } from 'react-i18next';
import { IconSettings } from '@/components/ui/icons';
import type { AccountGroup } from '@/services/api/accountGroups';
import {
  DEFAULT_GROUP_COLOR,
  GROUP_FILTER_ALL,
  GROUP_FILTER_UNGROUPED,
  type GroupCounts,
} from '../logic';
import styles from './GroupChipRow.module.scss';

export type GroupChipRowProps = {
  groups: AccountGroup[];
  counts: GroupCounts;
  /** 'all' | 'ungrouped' | group id */
  active: string;
  disabled?: boolean;
  onChange: (filter: string) => void;
  onManage: () => void;
};

/** 分组筛选 chip 行：全部 · 未分组 · 各分组（色点 + 计数）· 管理分组。单选。 */
export function GroupChipRow({
  groups,
  counts,
  active,
  disabled = false,
  onChange,
  onManage,
}: GroupChipRowProps) {
  const { t } = useTranslation();

  const chip = (value: string, label: string, count: number, color?: string) => {
    const isActive = active === value;
    return (
      <button
        key={value}
        type="button"
        className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
        aria-pressed={isActive}
        onClick={() => onChange(value)}
      >
        {color && (
          <span className={styles.dot} style={{ backgroundColor: color }} aria-hidden="true" />
        )}
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{count}</span>
      </button>
    );
  };

  return (
    <div className={styles.row} role="group" aria-label={t('account_groups.filter_label')}>
      <div className={styles.chips}>
        {chip(GROUP_FILTER_ALL, t('account_groups.filter_all'), counts.all)}
        {chip(GROUP_FILTER_UNGROUPED, t('account_groups.filter_ungrouped'), counts.ungrouped)}
        {groups.map((group) =>
          chip(group.id, group.name, counts.byId[group.id] ?? 0, group.color ?? DEFAULT_GROUP_COLOR)
        )}
      </div>
      <button type="button" className={styles.manage} onClick={onManage} disabled={disabled}>
        <IconSettings size={13} />
        {t('account_groups.manage')}
      </button>
    </div>
  );
}

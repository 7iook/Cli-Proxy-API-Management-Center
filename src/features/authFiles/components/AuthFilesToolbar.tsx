import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DisplayOptionsPopover } from '@/components/common/DisplayOptionsPopover';
import { SortControl, type SortFieldOption } from '@/components/common/SortControl';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconSearch, IconTrash2 } from '@/components/ui/icons';
import { MAX_CARD_PAGE_SIZE, MIN_CARD_PAGE_SIZE } from '@/features/authFiles/constants';
import type {
  AuthFilesSort,
  AuthFilesSortField,
  AuthFilesStatusFilterMode,
} from '@/features/preferences/schema';
import styles from './AuthFilesToolbar.module.scss';

export type AuthFilesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilterMode: AuthFilesStatusFilterMode;
  statusFilterOptions: Array<{ value: AuthFilesStatusFilterMode; label: string }>;
  onStatusFilterChange: (mode: AuthFilesStatusFilterMode) => void;
  sort: AuthFilesSort;
  sortFields: Array<SortFieldOption<AuthFilesSortField>>;
  onSortChange: (sort: AuthFilesSort) => void;
  pageSizeInput: string;
  onPageSizeInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPageSizeCommit: (rawValue: string) => void;
  deleteLabel: string;
  deleteTitle?: string;
  deleteDisabled: boolean;
  deleteLoading: boolean;
  onDelete: () => void;
};

/**
 * 工作区工具栏：搜索 · 状态分段 · 排序 · 显示选项 popover。
 * 「删除筛选结果」放在工具栏最右端——与限定它作用域的过滤器相邻（映射原则）。
 */
export function AuthFilesToolbar(props: AuthFilesToolbarProps) {
  const {
    search,
    onSearchChange,
    statusFilterMode,
    statusFilterOptions,
    onStatusFilterChange,
    sort,
    sortFields,
    onSortChange,
    pageSizeInput,
    onPageSizeInputChange,
    onPageSizeCommit,
    deleteLabel,
    deleteTitle,
    deleteDisabled,
    deleteLoading,
    onDelete,
  } = props;
  const { t } = useTranslation();
  return (
    <div className={styles.toolbar}>
      <div className={styles.search}>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('auth_files.search_placeholder')}
          aria-label={t('auth_files.search_label')}
          rightElement={<IconSearch className={styles.searchIcon} size={16} />}
        />
      </div>

      <div
        className={styles.segmented}
        role="group"
        aria-label={t('auth_files.problem_filter_label')}
      >
        {statusFilterOptions.map((option) => {
          const isActive = statusFilterMode === option.value;
          const isProblem = option.value === 'problem';
          return (
            <button
              key={option.value}
              type="button"
              className={`${styles.segment} ${isActive ? styles.segmentActive : ''} ${
                isProblem ? styles.segmentProblem : ''
              }`}
              aria-pressed={isActive}
              onClick={() => onStatusFilterChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <SortControl
        value={sort}
        fields={sortFields}
        onChange={onSortChange}
        ariaLabel={t('auth_files.sort_label')}
      />

      <DisplayOptionsPopover
        rows={[
          {
            key: 'pageSize',
            label: t('auth_files.page_size_label'),
            htmlFor: 'auth-files-page-size',
            control: (
              <input
                id="auth-files-page-size"
                className={styles.pageSizeInput}
                type="number"
                min={MIN_CARD_PAGE_SIZE}
                max={MAX_CARD_PAGE_SIZE}
                step={1}
                value={pageSizeInput}
                onChange={onPageSizeInputChange}
                onBlur={(e) => onPageSizeCommit(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
            ),
          },
        ]}
      />

      <button
        type="button"
        className={styles.deleteAction}
        onClick={onDelete}
        disabled={deleteDisabled}
        title={deleteTitle}
      >
        {deleteLoading ? <LoadingSpinner size={13} /> : <IconTrash2 size={14} />}
        {deleteLabel}
      </button>
    </div>
  );
}

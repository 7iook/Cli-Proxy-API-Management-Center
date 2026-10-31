import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { IconArrowUp } from '@/components/ui/icons';
import {
  defaultDirectionFor,
  isDirectionalSortField,
  type SortSpec,
} from '@/features/preferences/schema';
import styles from './SortControl.module.scss';

/** Keep in sync with `.field` in SortControl.module.scss. */
const FIELD_WIDTH = 124;

export interface SortFieldOption<F extends string> {
  value: F;
  /** Short label: the trigger never wraps, so keep it to a few characters. */
  label: string;
  /** Field-specific meaning of each direction, e.g. "least remaining first". */
  ascHint?: string;
  descHint?: string;
}

export interface SortControlProps<F extends string> {
  value: SortSpec<F>;
  fields: ReadonlyArray<SortFieldOption<F>>;
  onChange: (next: SortSpec<F>) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/** Field select plus an ascending/descending toggle; shared by the auth-files and quota pages. */
export function SortControl<F extends string>({
  value,
  fields,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: SortControlProps<F>) {
  const { t } = useTranslation();
  const current = fields.find((field) => field.value === value.field);
  const descending = value.direction === 'desc';
  const hint = descending ? current?.descHint : current?.ascHint;
  const order = `${t(descending ? 'sort_control.descending' : 'sort_control.ascending')}${
    hint ? ` · ${hint}` : ''
  }`;
  const directionLabel = t('sort_control.direction_toggle', { order });

  return (
    <div className={`${styles.root} ${className ?? ''}`.trim()}>
      <Select
        value={value.field}
        options={fields}
        onChange={(next) => {
          if (next !== value.field) {
            onChange({ field: next as F, direction: defaultDirectionFor(next) });
          }
        }}
        ariaLabel={ariaLabel}
        className={styles.field}
        dropdownClassName={styles.dropdown}
        dropdownMinWidth={FIELD_WIDTH}
        fullWidth={false}
        size="sm"
        disabled={disabled}
      />
      {isDirectionalSortField(value.field) && (
        <button
          type="button"
          className={`${styles.direction} ${descending ? styles.directionDesc : ''}`}
          aria-pressed={descending}
          aria-label={directionLabel}
          title={directionLabel}
          disabled={disabled}
          onClick={() => onChange({ ...value, direction: descending ? 'asc' : 'desc' })}
        >
          <IconArrowUp size={14} />
        </button>
      )}
    </div>
  );
}

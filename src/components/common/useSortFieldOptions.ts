import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SortFieldOption } from './SortControl';

/** i18n keys (under `sort_control`) of the direction hints of each directional field. */
const DIRECTION_HINTS: Record<string, readonly [asc: string, desc: string]> = {
  az: ['hint_az_asc', 'hint_az_desc'],
  priority: ['hint_priority_asc', 'hint_priority_desc'],
  fiveHour: ['hint_remaining_asc', 'hint_remaining_desc'],
  weekly: ['hint_remaining_asc', 'hint_remaining_desc'],
  weeklyReset: ['hint_reset_asc', 'hint_reset_desc'],
};

/** Short labels and direction hints for the given sort fields, in order. */
export function useSortFieldOptions<F extends string>(
  fields: readonly F[]
): Array<SortFieldOption<F>> {
  const { t } = useTranslation();
  return useMemo(
    () =>
      fields.map((field) => {
        const hints = DIRECTION_HINTS[field];
        return {
          value: field,
          label: t(`sort_control.field_${field}`),
          ascHint: hints && t(`sort_control.${hints[0]}`),
          descHint: hints && t(`sort_control.${hints[1]}`),
        };
      }),
    [fields, t]
  );
}

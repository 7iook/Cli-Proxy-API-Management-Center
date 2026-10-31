/**
 * Compact quota: the 5-hour and weekly windows as two dense rows. Each row
 * is a label, a thin remaining-quota bar and the remaining percent, with the
 * reset time in small type under the bar ("5h ▬▬▬▬▭ 72% / resets in 2h"). `QuotaSummaryRows` renders from a quota
 * state; `QuotaSummary` binds it to the store and adds a refresh button.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import { formatRelativeInstant } from '@/utils/quota';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { resolveQuotaResetKey, resolveQuotaSortKey, type QuotaWindowKind } from '../quotaSortKey';
import { useFileQuotaState } from '../hooks/useFileQuotaState';
import { useRefreshFileQuota } from '../hooks/useRefreshFileQuota';
import { summaryRemainingTone } from './quotaSummaryTone';
import styles from './QuotaSummary.module.scss';

const WINDOWS: ReadonlyArray<{ kind: QuotaWindowKind; labelKey: string }> = [
  { kind: 'fiveHour', labelKey: 'quota_summary.five_hour' },
  { kind: 'weekly', labelKey: 'quota_summary.weekly' },
];

const TONE_CLASSES = {
  high: { fill: styles.fillHigh, percent: undefined },
  medium: { fill: styles.fillMedium, percent: undefined },
  low: { fill: styles.fillLow, percent: styles.percentLow },
} as const;

export interface QuotaSummaryRowsProps {
  type: QuotaProviderType;
  quota?: QuotaCardState;
}

export function QuotaSummaryRows({ type, quota }: QuotaSummaryRowsProps) {
  const { t, i18n } = useTranslation();
  const nowMs = useNow();
  const status = quota?.status ?? 'idle';

  if (status !== 'success') {
    const messageKey =
      status === 'loading' ? 'loading' : status === 'error' ? 'load_failed' : 'no_data';
    return <div className={styles.message}>{t(`quota_summary.${messageKey}`)}</div>;
  }

  const rows = WINDOWS.map(({ kind, labelKey }) => ({
    kind,
    label: t(labelKey),
    remaining: resolveQuotaSortKey(type, quota, kind, nowMs),
    reset: resolveQuotaResetKey(type, quota, kind, nowMs),
  }));
  if (rows.every((row) => row.remaining.status !== 'value')) {
    return <div className={styles.message}>—</div>;
  }

  return (
    <div className={styles.rows}>
      {rows.map(({ kind, label, remaining, reset }) => {
        const value = remaining.status === 'value' ? Math.round(remaining.remaining) : null;
        const clamped = value === null ? 0 : Math.min(100, Math.max(0, value));
        const tone = value === null ? null : TONE_CLASSES[summaryRemainingTone(value)];
        return (
          <div key={kind} className={styles.row} data-window={kind}>
            <span className={styles.label}>{label}</span>
            <span
              className={styles.track}
              role="progressbar"
              aria-label={t('quota_summary.remaining_aria', { label })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value ?? undefined}
            >
              {value !== null && (
                <span className={`${styles.fill} ${tone?.fill ?? ''}`} style={{ width: `${clamped}%` }} />
              )}
            </span>
            <span className={`${styles.percent} ${tone?.percent ?? ''}`}>
              {value === null ? '—' : `${value}%`}
            </span>
            {value !== null && reset.status === 'value' && (
              <span className={styles.reset}>
                {reset.estimated ? '≈ ' : ''}
                {t('quota_summary.resets', {
                  relative: formatRelativeInstant(reset.atMs, nowMs, i18n.language),
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface QuotaSummaryProps {
  file: AuthFileItem;
  type: QuotaProviderType;
  disableControls: boolean;
}

export function QuotaSummary({ file, type, disableControls }: QuotaSummaryProps) {
  const { t } = useTranslation();
  const quota = useFileQuotaState(file, type);
  const refresh = useRefreshFileQuota(disableControls);
  const loading = quota?.status === 'loading';

  return (
    <div className={styles.summary}>
      <QuotaSummaryRows type={type} quota={quota} />
      <button
        type="button"
        className={styles.refresh}
        title={t('auth_files.quota_refresh_hint')}
        aria-label={t('auth_files.quota_refresh_hint')}
        disabled={disableControls || file.disabled === true || loading}
        onClick={() => void refresh(file, QUOTA_ADAPTERS[type])}
      >
        <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
      </button>
    </div>
  );
}

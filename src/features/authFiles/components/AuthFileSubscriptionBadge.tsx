import { useTranslation } from 'react-i18next';
import {
  describeSubscriptionBadge,
  type SubscriptionPeriod,
} from '@/features/authFiles/subscription';
import styles from './AuthFileSubscriptionBadge.module.scss';

export type AuthFileSubscriptionBadgeProps = {
  period: SubscriptionPeriod;
  /** When provided the pill becomes a button (e.g. opens the editor). */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

/** Claude subscription validity pill: green / amber (≤7 days, today) / red / grey (unset). */
export function AuthFileSubscriptionBadge(props: AuthFileSubscriptionBadgeProps) {
  const { period, onClick, disabled, className } = props;
  const { t } = useTranslation();
  const badge = describeSubscriptionBadge(period);
  const label = t(badge.labelKey, badge.labelParams);
  const cycle = t(
    period.cycle === 'annual'
      ? 'auth_files.subscription_cycle_annual'
      : 'auth_files.subscription_cycle_monthly'
  );
  const tooltip = badge.tooltipKey
    ? t(badge.tooltipKey, { ...badge.tooltipParams, cycle })
    : t('auth_files.subscription_badge_unset_hint');
  const classes = [styles.badge, styles[badge.tone], className ?? ''].filter(Boolean).join(' ');
  const content = (
    <>
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        title={tooltip}
        aria-label={`${label} · ${tooltip}`}
        disabled={disabled}
        data-tier={badge.tier}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={classes} title={tooltip} data-tier={badge.tier}>
      {content}
    </span>
  );
}

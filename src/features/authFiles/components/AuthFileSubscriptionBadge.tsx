import { useTranslation } from 'react-i18next';
import { IconCalendar } from '@/components/ui/icons';
import {
  describeSubscriptionBadge,
  type SubscriptionPeriod,
} from '@/features/authFiles/subscription';
import styles from './AuthFileSubscriptionBadge.module.scss';

export type AuthFileSubscriptionBadgeProps = {
  period: SubscriptionPeriod;
  /** When provided the badge becomes a button (e.g. opens the editor). */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Claude subscription validity row (cockpit-tools style):
 * calendar icon + 订阅有效期 + coloured remaining (N天 / N小时 / 今天到期 / 已过期) + exact expiry.
 * Tones: green / amber (≤7 days, under a day) / red / grey (unset).
 */
export function AuthFileSubscriptionBadge(props: AuthFileSubscriptionBadgeProps) {
  const { period, onClick, disabled, className } = props;
  const { t } = useTranslation();
  const badge = describeSubscriptionBadge(period);
  const isUnset = badge.tier === 'unset';
  const title = t('auth_files.subscription_badge_title');
  const remaining = t(badge.remainingKey, badge.remainingParams);
  const cycle = t(
    period.cycle === 'annual'
      ? 'auth_files.subscription_cycle_annual'
      : 'auth_files.subscription_cycle_monthly'
  );
  const tooltip = badge.tooltipKey
    ? t(badge.tooltipKey, { ...badge.tooltipParams, cycle })
    : t('auth_files.subscription_badge_unset_hint');
  const classes = [styles.badge, styles[badge.tone], className ?? ''].filter(Boolean).join(' ');
  const label = isUnset ? remaining : `${title} ${remaining} ${badge.expiresText}`.trim();
  const content = (
    <>
      <IconCalendar className={styles.icon} size={12} />
      {isUnset ? (
        <span className={styles.title}>{remaining}</span>
      ) : (
        <>
          <span className={styles.main}>
            <span className={styles.title}>{title}</span>
            <span className={styles.remaining}>{remaining}</span>
          </span>
          {badge.expiresText && <span className={styles.expires}>{badge.expiresText}</span>}
        </>
      )}
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

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { formatQuotaCachedAt } from '@/stores/quotaPersistence';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';

/**
 * Marks quota that was not fetched in this page session: either a backend passive
 * snapshot from real requests, or a result restored from the browser cache.
 */
export function QuotaCachedLabel({ quota, className }: { quota: unknown; className?: string }) {
  const { t, i18n } = useTranslation();
  const state = quota as { cachedAt?: unknown; passiveAt?: unknown } | undefined;
  const passiveAt = typeof state?.passiveAt === 'number' ? state.passiveAt : null;
  const nowMs = useNow(passiveAt !== null);
  if (passiveAt !== null) {
    const ago = formatRelativeInstant(
      Math.min(passiveAt, nowMs),
      nowMs,
      i18n.resolvedLanguage ?? i18n.language
    );
    return (
      <div className={className} title={new Date(passiveAt).toLocaleString()} data-quota-passive="">
        {t('quota_cache.passive_at', { ago })}
      </div>
    );
  }
  const cachedAt = state?.cachedAt;
  if (typeof cachedAt !== 'number') return null;
  return (
    <div className={className} title={new Date(cachedAt).toLocaleString()} data-quota-cached="">
      {t('quota_cache.cached_at', { time: formatQuotaCachedAt(cachedAt) })}
    </div>
  );
}

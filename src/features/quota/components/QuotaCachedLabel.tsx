import { useTranslation } from 'react-i18next';
import { formatQuotaCachedAt } from '@/stores/quotaPersistence';

/** Marks quota restored from the browser cache with the time it was captured. */
export function QuotaCachedLabel({ quota, className }: { quota: unknown; className?: string }) {
  const { t } = useTranslation();
  const cachedAt = (quota as { cachedAt?: unknown } | undefined)?.cachedAt;
  if (typeof cachedAt !== 'number') return null;
  return (
    <div className={className} title={new Date(cachedAt).toLocaleString()} data-quota-cached="">
      {t('quota_cache.cached_at', { time: formatQuotaCachedAt(cachedAt) })}
    </div>
  );
}

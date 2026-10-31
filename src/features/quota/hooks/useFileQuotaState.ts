import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType, QuotaStore } from '../providers/types';

/** The cached quota state of one credential for its provider. */
export function useFileQuotaState(
  file: AuthFileItem,
  type: QuotaProviderType
): QuotaCardState | undefined {
  const { storeSelector } = QUOTA_ADAPTERS[type];
  const cacheKey = getQuotaCacheKey(file);
  return useQuotaStore((state) => storeSelector(state as unknown as QuotaStore)[cacheKey]);
}

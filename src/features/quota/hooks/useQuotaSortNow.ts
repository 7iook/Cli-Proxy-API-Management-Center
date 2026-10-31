import { useEffect, useState } from 'react';

/**
 * Instant used to evaluate "already reset" windows when sorting by remaining quota.
 * It is re-read only when the quota data changes (or the sort becomes active),
 * never on a clock tick, so cards do not reorder by themselves.
 */
export function useQuotaSortNow(active: boolean, dataVersion: unknown): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (active) setNowMs(Date.now());
  }, [active, dataVersion]);
  return nowMs;
}

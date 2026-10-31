import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  buildPassiveClaudeQuotaState,
  readPassiveQuotaSnapshot,
  shouldApplyPassiveQuota,
} from '@/features/quota/providers/claude/passiveSnapshot';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isClaudeFile } from '@/utils/quota/validators';

/** Compute the Claude quota entries a credential list's passive snapshots should set. */
export function collectPassiveClaudeQuota(
  files: AuthFileItem[],
  current: Record<string, ClaudeQuotaState>,
  t: TFunction,
  nowMs: number = Date.now()
): Record<string, ClaudeQuotaState> {
  const updates: Record<string, ClaudeQuotaState> = {};
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !isClaudeFile(file)) continue;
    const snapshot = readPassiveQuotaSnapshot(file);
    if (!snapshot) continue;
    const key = getQuotaCacheKey(file);
    const existing = current[key];
    if (!shouldApplyPassiveQuota(existing, snapshot.capturedAtMs)) continue;
    const next = buildPassiveClaudeQuotaState(snapshot, t, nowMs);
    // Headers carry no plan; keep a plan learned earlier for the same credential.
    if (existing?.planType) next.planType = existing.planType;
    updates[key] = next;
  }
  return updates;
}

/** Render backend passive quota snapshots without issuing any quota request. */
export function applyPassiveQuotaSnapshots(files: AuthFileItem[] | undefined): void {
  if (!Array.isArray(files) || files.length === 0) return;
  try {
    const store = useQuotaStore.getState();
    const updates = collectPassiveClaudeQuota(files, store.claudeQuota, i18n.t.bind(i18n));
    if (Object.keys(updates).length === 0) return;
    store.setClaudeQuota((prev) => ({ ...prev, ...updates }));
  } catch {
    // Passive display is best effort; never break the credential list.
  }
}

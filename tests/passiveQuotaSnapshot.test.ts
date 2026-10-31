import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import i18n from '../src/i18n/index';
import {
  buildPassiveClaudeQuotaState,
  readPassiveQuotaSnapshot,
  shouldApplyPassiveQuota,
} from '../src/features/quota/providers/claude/passiveSnapshot';
import {
  applyPassiveQuotaSnapshots,
  collectPassiveClaudeQuota,
} from '../src/stores/passiveQuotaSync';
import { hydrateQuotaMaps, mergeFreshQuota } from '../src/stores/quotaPersistence';
import { useQuotaStore } from '../src/stores/useQuotaStore';
import { authFilesApi, setAuthFilesListObserver } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import { QuotaCachedLabel } from '../src/features/quota/components/QuotaCachedLabel';
import type { AuthFileItem, ClaudeQuotaState } from '../src/types';

const t = ((key: string) => key) as unknown as TFunction;
const NOW = Date.parse('2026-10-30T20:00:00Z');
const CAPTURED = '2026-10-30T19:55:00Z';
const CAPTURED_MS = Date.parse(CAPTURED);

const snapshotField = {
  captured_at: CAPTURED,
  source: 'passive',
  windows: {
    five_hour: { utilization: 20, resets_at: '2026-10-30T22:00:00Z' },
    seven_day: { utilization: 63.5, resets_at: '2026-10-30T19:00:00Z' },
    iguana_necktie: { utilization: 5, resets_at: null },
  },
};

const claudeFile = (extra: Record<string, unknown> = {}): AuthFileItem =>
  ({
    name: 'claude-a.json',
    type: 'claude',
    quota_snapshot: snapshotField,
    ...extra,
  }) as AuthFileItem;

describe('passive quota snapshot parsing', () => {
  test('reads the backend field and ignores files without one', () => {
    const parsed = readPassiveQuotaSnapshot(claudeFile());
    expect(parsed?.capturedAtMs).toBe(CAPTURED_MS);
    expect(Object.keys(parsed?.windows ?? {}).sort()).toEqual([
      'five_hour',
      'iguana_necktie',
      'seven_day',
    ]);
    expect(readPassiveQuotaSnapshot({ name: 'x', type: 'claude' } as AuthFileItem)).toBeNull();
    expect(
      readPassiveQuotaSnapshot(claudeFile({ quota_snapshot: { captured_at: 'bad', windows: {} } }))
    ).toBeNull();
    expect(
      readPassiveQuotaSnapshot(
        claudeFile({ quota_snapshot: { captured_at: CAPTURED, windows: {} } })
      )
    ).toBeNull();
  });

  test('builds the same success state shape as a manual refresh, resetting elapsed windows', () => {
    const state = buildPassiveClaudeQuotaState(readPassiveQuotaSnapshot(claudeFile())!, t, NOW);
    expect(state.status).toBe('success');
    expect(state.passiveAt).toBe(CAPTURED_MS);
    expect(state.observedAt).toBe(new Date(CAPTURED_MS).toISOString());
    const byId = Object.fromEntries(state.windows.map((w) => [w.id, w]));
    expect(byId['five-hour'].usedPercent).toBe(20);
    expect(byId['five-hour'].resetAtMs).toBe(Date.parse('2026-10-30T22:00:00Z'));
    expect(byId['five-hour'].periodHours).toBe(5);
    // seven_day reset at 19:00, before NOW: shown as reset.
    expect(byId['seven-day'].usedPercent).toBe(0);
    expect(byId['seven-day'].resetAtMs).toBeNull();
    expect(byId['seven-day-fable'].usedPercent).toBe(5);
  });
});

describe('passive quota priority', () => {
  const passive = (at: number): ClaudeQuotaState => ({
    status: 'success',
    windows: [],
    passiveAt: at,
  });

  test('session results win; cached and older passive entries yield to newer captures', () => {
    expect(shouldApplyPassiveQuota(undefined, CAPTURED_MS)).toBe(true);
    expect(shouldApplyPassiveQuota({ status: 'idle', windows: [] }, CAPTURED_MS)).toBe(true);
    // Manual refresh in this session: success, loading or failure all stay.
    expect(shouldApplyPassiveQuota({ status: 'success', windows: [] }, CAPTURED_MS)).toBe(false);
    expect(shouldApplyPassiveQuota({ status: 'loading', windows: [] }, CAPTURED_MS)).toBe(false);
    expect(
      shouldApplyPassiveQuota({ status: 'error', windows: [], errorStatus: 403 }, CAPTURED_MS)
    ).toBe(false);
    // Browser cache: newest capture wins.
    const cached = (at: number): ClaudeQuotaState => ({
      status: 'success',
      windows: [],
      cachedAt: at,
    });
    expect(shouldApplyPassiveQuota(cached(CAPTURED_MS - 1), CAPTURED_MS)).toBe(true);
    expect(shouldApplyPassiveQuota(cached(CAPTURED_MS + 1), CAPTURED_MS)).toBe(false);
    // Earlier passive snapshot is replaced only by a newer one.
    expect(shouldApplyPassiveQuota(passive(CAPTURED_MS - 1), CAPTURED_MS)).toBe(true);
    expect(shouldApplyPassiveQuota(passive(CAPTURED_MS), CAPTURED_MS)).toBe(false);
  });

  test('collects updates only for Claude files and keeps a known plan', () => {
    const files = [
      claudeFile(),
      { name: 'codex.json', type: 'codex', quota_snapshot: snapshotField } as AuthFileItem,
      { ...claudeFile(), name: 'claude-live.json' } as AuthFileItem,
      { ...claudeFile(), name: 'claude-failed.json' } as AuthFileItem,
    ];
    const updates = collectPassiveClaudeQuota(
      files,
      {
        'claude-a.json': {
          status: 'success',
          windows: [],
          cachedAt: CAPTURED_MS - 60_000,
          planType: 'plan_max20',
        },
        'claude-live.json': { status: 'success', windows: [], observedAt: CAPTURED },
        'claude-failed.json': { status: 'error', windows: [], errorStatus: 403, error: 'x' },
      },
      t,
      NOW
    );
    expect(Object.keys(updates)).toEqual(['claude-a.json']);
    expect(updates['claude-a.json'].planType).toBe('plan_max20');
    expect(updates['claude-a.json'].passiveAt).toBe(CAPTURED_MS);
  });

  test('browser cache never persists passive entries and only displaces older ones', () => {
    const passiveState = { status: 'success', windows: [], passiveAt: CAPTURED_MS };
    expect(mergeFreshQuota({}, { claudeQuota: { a: passiveState } })).toEqual({});

    const entry = (cachedAt: number) => ({
      claudeQuota: { a: { cachedAt, state: { windows: [{ id: 'five-hour' }] } } },
    });
    const newer = hydrateQuotaMaps(entry(CAPTURED_MS + 1), { claudeQuota: { a: passiveState } });
    expect((newer.claudeQuota?.a as { cachedAt?: number }).cachedAt).toBe(CAPTURED_MS + 1);
    const older = hydrateQuotaMaps(entry(CAPTURED_MS - 1), { claudeQuota: { a: passiveState } });
    expect(older.claudeQuota).toBeUndefined();
    const live = hydrateQuotaMaps(entry(CAPTURED_MS + 1), {
      claudeQuota: { a: { status: 'success', windows: [] } },
    });
    expect(live.claudeQuota).toBeUndefined();
  });
});

describe('passive quota wiring', () => {
  afterEach(() => {
    setAuthFilesListObserver(null);
    useQuotaStore.setState({ claudeQuota: {} });
  });

  test('loading the credential list fills the store without any quota request', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ files: [claudeFile()] } as never);
    const post = spyOn(apiClient, 'post');
    setAuthFilesListObserver(applyPassiveQuotaSnapshots);
    try {
      await authFilesApi.list();
      const state = useQuotaStore.getState().claudeQuota['claude-a.json'];
      expect(state?.status).toBe('success');
      expect(state?.passiveAt).toBe(CAPTURED_MS);
      expect(get).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      post.mockRestore();
    }
  });

  test('labels passive data as coming from real requests', async () => {
    const previous = i18n.language;
    await i18n.changeLanguage('zh-CN');
    try {
      const markup = renderToStaticMarkup(
        createElement(QuotaCachedLabel, {
          quota: { status: 'success', windows: [], passiveAt: Date.now() - 5 * 60_000 },
        })
      );
      expect(markup).toContain('来自真实请求');
      expect(markup).toContain('data-quota-passive');
      expect(markup).toContain('分钟前');
    } finally {
      await i18n.changeLanguage(previous);
    }
  });
});

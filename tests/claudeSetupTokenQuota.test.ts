import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CLAUDE_CONFIG } from '../src/features/quota/providers/claude/data';
import { apiCallApi } from '../src/services/api/apiCall';
import {
  AnthropicResetGrantError,
  readClaudeResetGrants,
} from '../src/services/api/claudeResetGrants';
import type { AuthFileItem } from '../src/types';

const t = ((key: string) => key) as TFunction;
const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
});

const reset = '2026-11-16T08:00:00Z';
const file = { name: 'claude-setup-token.json', type: 'claude', auth_index: 7 } as AuthFileItem;

/** CPA's header-derived usage body for a setup-token credential; profile is out of scope. */
const mockSetupToken = (usage: Record<string, unknown>) => {
  apiCallApi.request = async (request) =>
    request.url.endsWith('/profile')
      ? {
          statusCode: 403,
          body: { error: { type: 'permission_error' } },
          bodyText: '',
          header: {},
        }
      : { statusCode: 200, body: usage, bodyText: '', header: {} };
};

describe('Claude setup-token quota', () => {
  test('header-derived body renders the Fable row; profile 403 only drops the plan', async () => {
    mockSetupToken({
      captured_at: '2026-11-10T10:00:00Z',
      five_hour: { utilization: 12, resets_at: reset },
      seven_day: { utilization: 30, resets_at: reset },
      iguana_necktie: { utilization: 41, resets_at: reset },
    });
    const data = await CLAUDE_CONFIG.fetchQuota(file, t);
    expect(data.planType).toBeNull();
    expect(data.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['five-hour', 12],
      ['seven-day', 30],
      ['seven-day-fable', 41],
    ]);
  });

  test('no Fable observation means no Fable row', async () => {
    mockSetupToken({
      captured_at: '2026-11-10T10:00:00Z',
      five_hour: { utilization: 12, resets_at: reset },
      seven_day: { utilization: 30, resets_at: reset },
    });
    const data = await CLAUDE_CONFIG.fetchQuota(file, t);
    expect(data.windows.map((window) => window.id)).toEqual(['five-hour', 'seven-day']);
  });

  test('usage without a cedar_ember block reports absent reset data', async () => {
    mockSetupToken({ five_hour: { utilization: 12, resets_at: reset } });
    const error = await readClaudeResetGrants('7').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnthropicResetGrantError);
    expect((error as AnthropicResetGrantError).code).toBe('absent');
  });

  test('a present but unusable cedar_ember block stays malformed', async () => {
    mockSetupToken({ cedar_ember: null });
    await expect(readClaudeResetGrants('7')).rejects.toMatchObject({ code: 'malformed' });
  });

  test('sibling OAuth usage body keeps the original reset-grant parsing', async () => {
    mockSetupToken({
      cedar_ember: {
        eligible: true,
        at_limit: false,
        grants: [{ id: 'fable-launch', resets_total: 1, resets_left: 1, usable_now: true }],
      },
    });
    const status = await readClaudeResetGrants('7');
    expect(status.grants.map((grant) => [grant.id, grant.resetsLeft])).toEqual([
      ['fable-launch', 1],
    ]);
  });
});

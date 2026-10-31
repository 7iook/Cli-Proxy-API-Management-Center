import { describe, expect, test } from 'bun:test';
import {
  buildWildcardSearch,
  collectMissingQuotaEntries,
  createAuthFileQuotaKeyResolver,
  matchesAuthFileSearch,
  resolveAuthFileQuotaType,
  sortAuthFiles,
} from '../src/features/authFiles/logic';
import type { QuotaSortKey } from '../src/features/quota/quotaSortKey';
import type { AuthFileItem } from '../src/types';

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'credential.json',
  type: 'codex',
  ...overrides,
});

const search = (file: AuthFileItem, term: string) =>
  matchesAuthFileSearch(file, term, buildWildcardSearch(term));

describe('buildWildcardSearch', () => {
  test('returns null when the term has no wildcard', () => {
    expect(buildWildcardSearch('user@example.com')).toBeNull();
  });

  test('stays unanchored — segments may match anywhere in the value', () => {
    expect(buildWildcardSearch('a*b')?.test('zzzaqqbzzz')).toBe(true);
  });

  test('escapes regex metacharacters in the segments', () => {
    const pattern = buildWildcardSearch('u+1*');
    expect(pattern?.test('u+1@x.com')).toBe(true);
    expect(pattern?.test('u1@x.com')).toBe(false);
  });

  test('a lone wildcard matches everything', () => {
    expect(buildWildcardSearch('*')?.test('anything')).toBe(true);
  });
});

describe('resolveAuthFileQuotaType', () => {
  test('resolves each supported provider while the all tab is selected', () => {
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), 'all')).toBe('codex');
    expect(resolveAuthFileQuotaType(authFile({ type: 'kimi' }), 'all')).toBe('kimi');
  });

  test('does not expose quota for unsupported or mismatched providers', () => {
    expect(resolveAuthFileQuotaType(authFile({ type: 'gemini' }), 'all')).toBeNull();
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), 'claude')).toBeNull();
    expect(resolveAuthFileQuotaType(authFile({ type: 'codex' }), null)).toBeNull();
  });

  test('exposes a plugin quota on its own provider tab', () => {
    const kiro = authFile({ type: 'kiro', supportsQuota: true, quotaProvider: 'kiro' });
    expect(resolveAuthFileQuotaType(kiro, 'all')).toBe('plugin');
    expect(resolveAuthFileQuotaType(kiro, 'kiro')).toBe('plugin');
  });

  test('exposes a probe-only plugin quota without a provider identifier', () => {
    expect(resolveAuthFileQuotaType(authFile({ type: 'kiro', supportsQuota: true }), 'all')).toBe(
      'plugin'
    );
    expect(
      resolveAuthFileQuotaType(authFile({ type: 'kiro', supportsQuota: true }), 'plugin')
    ).toBe('plugin');
  });
});

describe('matchesAuthFileSearch', () => {
  test('an empty term matches every file', () => {
    expect(matchesAuthFileSearch(authFile(), '', null)).toBe(true);
  });

  test('matches the file name case-insensitively', () => {
    expect(search(authFile({ name: 'codex-a.json' }), 'CODEX')).toBe(true);
  });

  test('matches the type and the provider', () => {
    expect(search(authFile({ type: 'antigravity' }), 'antigrav')).toBe(true);
    expect(search(authFile({ type: undefined, provider: 'gemini' }), 'gemi')).toBe(true);
  });

  test('finds a kimi credential by account email even though its name carries none', () => {
    expect(
      search(
        authFile({ name: 'kimi-1712345678901.json', type: 'kimi', email: 'user@example.com' }),
        'user@example'
      )
    ).toBe(true);
  });

  test('matches the project id', () => {
    expect(search(authFile({ name: 'vertex-x.json', projectId: 'my-proj' }), 'my-proj')).toBe(true);
  });

  test('searches the email on the wildcard path too', () => {
    expect(
      search(authFile({ name: 'kimi-1712345678901.json', email: 'user@example.com' }), 'user@*com')
    ).toBe(true);
  });

  test('finds credentials by HTTP error code or error content', () => {
    const forbidden = authFile({ statusMessage: '403 Forbidden: invalid credentials' });
    const rateLimited = authFile({
      statusMessage: '{"error":{"code":429,"message":"Rate limit exceeded"}}',
    });
    expect(search(forbidden, '403')).toBe(true);
    expect(search(forbidden, 'INVALID')).toBe(true);
    expect(search(forbidden, '403 Forbidden: invalid credentials')).toBe(true);
    expect(search(forbidden, '429')).toBe(false);
    expect(search(rateLimited, '429')).toBe(true);
    expect(search(rateLimited, 'rate limit exceeded')).toBe(true);
  });

  test('uses the same status message as the card, including raw backend fields', () => {
    expect(search(authFile({ status_message: '403 Forbidden' }), '403')).toBe(true);
    expect(
      search(authFile({ status_message: '429 Too Many Requests', statusMessage: '403' }), '403')
    ).toBe(false);
  });

  test('supports wildcards in error content and treats regex punctuation literally', () => {
    const file = authFile({ statusMessage: '403: invalid_request (credentials)' });
    expect(search(file, '403*INVALID')).toBe(true);
    expect(search(file, 'invalid*(credentials)')).toBe(true);
    expect(search(file, 'invalid*[credentials]')).toBe(false);
  });

  test('does not search arbitrary credential metadata', () => {
    expect(search(authFile({ metadata: { secret: 'invalid-secret' } }), 'invalid')).toBe(false);
  });

  test('never matches the account field — it can be a raw API key', () => {
    expect(
      search(
        authFile({ name: 'gemini-apikey.json', account: 'sk-live-abcd', account_type: 'api_key' }),
        'sk-live'
      )
    ).toBe(false);
  });

  test('tolerates missing fields', () => {
    expect(search({ name: 'bare.json' }, 'zzz')).toBe(false);
  });
});

describe('sortAuthFiles', () => {
  test("'default' orders by provider then name", () => {
    const files = [
      authFile({ name: 'b.json', provider: 'kimi' }),
      authFile({ name: 'c.json', type: 'codex', provider: undefined }),
      authFile({ name: 'a.json', provider: 'kimi' }),
    ];
    expect(sortAuthFiles(files, 'default').map((file) => file.name)).toEqual([
      'c.json',
      'a.json',
      'b.json',
    ]);
  });

  test("'az' orders by the displayed primary row, not by the file name", () => {
    const files = [
      authFile({ name: 'zzz.json', email: 'aaa@example.com' }),
      authFile({ name: 'aaa.json', email: 'zzz@example.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual(['zzz.json', 'aaa.json']);
  });

  test("'az' falls back to the file name when primaries are equal", () => {
    const files = [
      authFile({ name: 'codex-abc-user@x.com-team.json', email: 'user@x.com' }),
      authFile({ name: 'codex-abc-user@x.com-plus.json', email: 'user@x.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual([
      'codex-abc-user@x.com-plus.json',
      'codex-abc-user@x.com-team.json',
    ]);
  });

  test("'az' mixes account primaries and file-name fallbacks coherently", () => {
    const files = [
      authFile({ name: 'kimi-9.json', type: 'kimi' }),
      authFile({ name: 'zzz.json', email: 'aaa@example.com' }),
    ];
    expect(sortAuthFiles(files, 'az').map((file) => file.name)).toEqual([
      'zzz.json',
      'kimi-9.json',
    ]);
  });

  test("'priority' orders descending, treats missing values as 0 and stays stable on ties", () => {
    const files = [
      authFile({ name: 'a.json' }),
      authFile({ name: 'b.json', priority: 5 }),
      authFile({ name: 'c.json' }),
      authFile({ name: 'd.json', priority: 9 }),
    ];
    expect(sortAuthFiles(files, 'priority').map((file) => file.name)).toEqual([
      'd.json',
      'b.json',
      'a.json',
      'c.json',
    ]);
  });

  test('returns a new array and leaves the input untouched', () => {
    const files = [authFile({ name: 'b.json' }), authFile({ name: 'a.json' })];
    const result = sortAuthFiles(files, 'az');
    expect(result).not.toBe(files);
    expect(files.map((file) => file.name)).toEqual(['b.json', 'a.json']);
  });

  test('an unknown mode returns an unsorted copy', () => {
    const files = [authFile({ name: 'b.json' }), authFile({ name: 'a.json' })];
    expect(sortAuthFiles(files, 'nope' as unknown as 'az').map((file) => file.name)).toEqual([
      'b.json',
      'a.json',
    ]);
  });
});

describe('group name search', () => {
  test('matches the group name only when provided', () => {
    const file = authFile({ name: 'x.json' });
    expect(matchesAuthFileSearch(file, 'pro', null, 'Pro Team')).toBe(true);
    expect(matchesAuthFileSearch(file, 'pro', null)).toBe(false);
    expect(matchesAuthFileSearch(file, 'p*team', buildWildcardSearch('p*team'), 'Pro Team')).toBe(
      true
    );
  });
});

describe('sortAuthFiles custom and quota modes', () => {
  const names = (files: AuthFileItem[]) => files.map((file) => file.name);
  const ranked = [
    authFile({ name: 'a.json', ui: { order: 30 } }),
    authFile({ name: 'b.json' }),
    authFile({ name: 'c.json', ui: { order: -5 } }),
    authFile({ name: 'd.json' }),
  ];

  test('custom puts ranked files first by order, the rest in default order', () => {
    expect(names(sortAuthFiles(ranked, 'custom'))).toEqual([
      'c.json',
      'a.json',
      'b.json',
      'd.json',
    ]);
  });

  test('quota modes use the injected resolver and sink missing/na files in both directions', () => {
    const keys: Record<string, QuotaSortKey> = {
      'a.json': { status: 'value', remaining: 80, resetAtMs: null, reset: false },
      'b.json': { status: 'missing' },
      'c.json': { status: 'value', remaining: 10, resetAtMs: null, reset: false },
      'd.json': { status: 'na' },
    };
    const kinds: string[] = [];
    const resolve = (file: AuthFileItem, kind: string): QuotaSortKey => {
      kinds.push(kind);
      return keys[file.name];
    };
    expect(names(sortAuthFiles(ranked, 'fiveHourAsc', resolve))).toEqual([
      'c.json',
      'a.json',
      'b.json',
      'd.json',
    ]);
    expect(names(sortAuthFiles(ranked, 'weeklyDesc', resolve))).toEqual([
      'a.json',
      'c.json',
      'b.json',
      'd.json',
    ]);
    expect(kinds).toContain('fiveHour');
    expect(kinds).toContain('weekly');
  });

  test('quota modes without a resolver fall back to the default order', () => {
    expect(names(sortAuthFiles(ranked, 'fiveHourAsc'))).toEqual(names(sortAuthFiles(ranked, 'default')));
  });

  test('createAuthFileQuotaKeyResolver reads the store state for the file provider', () => {
    const claude = authFile({ name: 'cl.json', type: 'claude' });
    const resolve = createAuthFileQuotaKeyResolver((type, key) => {
      expect(type).toBe('claude');
      expect(key).toBe('cl.json');
      return {
        status: 'success',
        windows: [{ id: 'five-hour', usedPercent: 25, resetAtMs: null, periodHours: 5 }],
      };
    }, 1_000);
    expect(resolve(claude, 'fiveHour')).toMatchObject({ status: 'value', remaining: 75 });
    expect(resolve(authFile({ name: 'x.json', type: 'unknown-provider' }), 'fiveHour')).toEqual({
      status: 'na',
    });
  });

  test('collectMissingQuotaEntries only reports quota-capable files in quota modes', () => {
    const files = [authFile({ name: 'a.json', type: 'codex' }), authFile({ name: 'b.json', type: 'codex' })];
    const resolve = (file: AuthFileItem): QuotaSortKey =>
      file.name === 'a.json' ? { status: 'missing' } : { status: 'na' };
    expect(collectMissingQuotaEntries(files, 'weeklyAsc', resolve).map((e) => e.file.name)).toEqual([
      'a.json',
    ]);
    expect(collectMissingQuotaEntries(files, 'default', resolve)).toEqual([]);
  });
});

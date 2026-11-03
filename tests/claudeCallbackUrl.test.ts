import { describe, expect, test } from 'bun:test';
import { CLAUDE_CALLBACK_URL, resolveCallbackUrl } from '@/features/oauth/callbackUrl';

const parse = (value: string | null) => {
  expect(value).not.toBeNull();
  const url = new URL(value as string);
  return {
    base: `${url.origin}${url.pathname}`,
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
  };
};

describe('Claude manual callback input', () => {
  for (const provider of ['claude-setup-token', 'anthropic']) {
    test(`${provider}: full URL passes through`, () => {
      const input = 'http://localhost:54545/callback?code=abc&state=s1';
      expect(resolveCallbackUrl(provider, input, 's1')).toBe(input);
    });

    test(`${provider}: code#state is rebuilt`, () => {
      const got = parse(resolveCallbackUrl(provider, '  abc123#s1  ', 'current'));
      expect(got).toEqual({ base: CLAUDE_CALLBACK_URL, code: 'abc123', state: 's1' });
    });

    test(`${provider}: bare code uses current login state`, () => {
      const got = parse(resolveCallbackUrl(provider, 'abc123', 'current'));
      expect(got).toEqual({ base: CLAUDE_CALLBACK_URL, code: 'abc123', state: 'current' });
    });

    test(`${provider}: query-like input`, () => {
      const got = parse(resolveCallbackUrl(provider, 'code=abc123&state=s2', 'current'));
      expect(got).toEqual({ base: CLAUDE_CALLBACK_URL, code: 'abc123', state: 's2' });
    });

    test(`${provider}: bare code without any state is rejected`, () => {
      expect(resolveCallbackUrl(provider, 'abc123', undefined)).toBeNull();
    });
  }

  test('other providers unchanged', () => {
    expect(resolveCallbackUrl('codex', ' raw ', 's')).toBe('raw');
  });
});

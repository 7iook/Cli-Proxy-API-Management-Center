import { describe, expect, test } from 'bun:test';
import { maskEmail, maskEmailsIn } from '@/utils/maskEmail';

describe('maskEmail', () => {
  test('keeps three local characters and the full domain', () => {
    expect(maskEmail('abcdef@gmail.com')).toBe('abc***@gmail.com');
    expect(maskEmail('first.last+tag@sub.example.co')).toBe('fir***@sub.example.co');
  });

  test('short local parts are kept whole', () => {
    expect(maskEmail('ab@x.io')).toBe('ab***@x.io');
    expect(maskEmail('abc@x.io')).toBe('abc***@x.io');
  });

  test('leaves non-email strings unchanged', () => {
    for (const value of ['', 'plain-name.json', '@nolocal.com', 'nodomain@', 'two words@x.com']) {
      expect(maskEmail(value)).toBe(value);
    }
  });
});

describe('maskEmailsIn', () => {
  test('masks a known email embedded in a file name, ignoring case', () => {
    expect(
      maskEmailsIn('codex-ab12cd34-Person@Example.com-plus.json', ['person@example.com'])
    ).toBe('codex-ab12cd34-Per***@Example.com-plus.json');
  });

  test('masks every occurrence and prefers the longest email', () => {
    expect(maskEmailsIn('a@x.com | abc@x.com | a@x.com', ['a@x.com', 'abc@x.com'])).toBe(
      'a***@x.com | abc***@x.com | a***@x.com'
    );
  });

  test('is a no-op without usable emails', () => {
    expect(maskEmailsIn('name.json', [undefined, null, ' '])).toBe('name.json');
    expect(maskEmailsIn('name.json', [])).toBe('name.json');
  });

  test('treats regex metacharacters in an email literally', () => {
    expect(maskEmailsIn('x-a+b.c@d.com-x', ['a+b.c@d.com'])).toBe('x-a+b***@d.com-x');
    expect(maskEmailsIn('x-aXb.c@d.com-x', ['a+b.c@d.com'])).toBe('x-aXb.c@d.com-x');
  });
});

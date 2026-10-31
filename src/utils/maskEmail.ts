/**
 * Display-only email masking: `abcdef@gmail.com` -> `abc***@gmail.com`.
 * Search and data paths keep using the real value.
 */

const KEEP_CHARS = 3;
const MASK = '***';

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1 || email.includes(' ')) return email;
  const local = email.slice(0, at);
  return `${local.slice(0, KEEP_CHARS)}${MASK}${email.slice(at)}`;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Masks known emails wherever they occur inside other text (codex file names
 * embed the account email). Matching is case-insensitive; the longest email wins.
 */
export function maskEmailsIn(
  text: string,
  emails: ReadonlyArray<string | null | undefined>
): string {
  const known = [
    ...new Set(
      emails.flatMap((email) => (typeof email === 'string' && email.trim() ? [email.trim()] : []))
    ),
  ].sort((a, b) => b.length - a.length);
  if (known.length === 0) return text;
  const pattern = new RegExp(known.map(escapeRegExp).join('|'), 'gi');
  return text.replace(pattern, (match) => maskEmail(match));
}

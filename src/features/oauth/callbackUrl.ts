/**
 * 手动回调输入 → 提交给后端的 redirect_url。
 *
 * 只有 xAI 需要拼装：Grok 有时只在页面显示 code，此时用本次登录的 state
 * 拼回固定的回环地址。其余提供商原样提交（Devin 另有严格校验，见 devinOAuth.ts）。
 */

export const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';

// 只认 http(s)：`code: xyz` 这类页面展示文本也能被 URL 解析（`code:` 是合法 scheme）。
const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const readQueryLikeCallbackInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams =
    queryStart >= 0
      ? trimmed.slice(queryStart + 1)
      : hashStart >= 0
        ? trimmed.slice(hashStart + 1)
        : trimmed;

  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
};

const extractDisplayedXaiCode = (value: string): string => {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i);
  return (codeMatch?.[1] ?? trimmed).trim();
};

const buildXaiCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const code = params.get('code')?.trim();
    const error = params.get('error')?.trim();
    const errorDescription = params.get('error_description')?.trim();
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;

    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    if (code) callbackUrl.searchParams.set('code', code);
    if (error) callbackUrl.searchParams.set('error', error);
    if (errorDescription) callbackUrl.searchParams.set('error_description', errorDescription);
    return callbackUrl.toString();
  }

  const code = extractDisplayedXaiCode(trimmed);
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;

  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
};

export const CLAUDE_CALLBACK_URL = 'http://localhost:54545/callback';
const CLAUDE_PROVIDERS = new Set(['anthropic', 'claude', 'claude-setup-token']);

/**
 * Claude 跨设备授权：用户可能粘贴完整回调 URL、Claude 页面展示的 `code#state`，
 * 或只有 code。非 http(s) 输入拼回固定回环地址，state 优先取 `#` 后片段，否则用本次登录的 state。
 */
const buildClaudeCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  let code: string | undefined;
  let callbackState: string | undefined;
  let error: string | undefined;
  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    code = params.get('code')?.trim() || undefined;
    callbackState = params.get('state')?.trim() || undefined;
    error = params.get('error')?.trim() || undefined;
  } else {
    const hashIndex = trimmed.indexOf('#');
    code = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).trim() || undefined;
    callbackState = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() || undefined : undefined;
  }
  if (code && code.includes('#')) {
    const [rawCode, fragmentState] = code.split('#', 2);
    code = rawCode.trim() || undefined;
    callbackState = callbackState || fragmentState?.trim() || undefined;
  }
  callbackState = callbackState || state?.trim() || undefined;
  if (!callbackState || (!code && !error)) return null;

  const callbackUrl = new URL(CLAUDE_CALLBACK_URL);
  if (code) callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  if (error) callbackUrl.searchParams.set('error', error);
  return callbackUrl.toString();
};

export const resolveCallbackUrl = (
  provider: string,
  input: string,
  state?: string
): string | null => {
  if (provider === 'xai') return buildXaiCallbackUrl(input, state);
  if (CLAUDE_PROVIDERS.has(provider)) return buildClaudeCallbackUrl(input, state);
  return input.trim();
};

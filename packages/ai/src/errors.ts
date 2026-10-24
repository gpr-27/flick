import type { AnswerInfo, AttemptResult, ProviderName } from './types.js';
import { parseRetryAfterMs } from './util.js';

export const RATE_LIMIT_COOLDOWN_MS = 60_000;
export const AUTH_COOLDOWN_MS = 60 * 60_000;
export const DAILY_QUOTA_COOLDOWN_MS = 60 * 60_000;
export const MODEL_UNAVAILABLE_COOLDOWN_MS = 60 * 60_000;
/** A 429 whose retry-after is at most this is retried once on the same entry. */
export const SAME_ENTRY_RETRY_MAX_MS = 2_000;

export class AiError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface AttemptFailure extends AnswerInfo {
  result: AttemptResult;
  status?: number;
}

/** Every configured entry failed, was cooling down, or no provider is configured. */
export class AiUnavailableError extends AiError {
  readonly failures: AttemptFailure[];
  constructor(failures: AttemptFailure[], message = 'All AI providers are unavailable') {
    super('ai_unavailable', message);
    this.failures = failures;
  }
}

/** A provider rejected our own request (HTTP 400/413/422...). Not retried on other providers. */
export class AiRequestError extends AiError {
  readonly status: number | undefined;
  readonly provider: ProviderName;
  readonly model: string;
  constructor(
    info: { provider: ProviderName; model: string; status: number | undefined },
    cause?: unknown,
  ) {
    super(
      'ai_bad_request',
      `${info.provider} rejected the request (status ${String(info.status)})`,
      { cause },
    );
    this.status = info.status;
    this.provider = info.provider;
    this.model = info.model;
  }
}

export class AiAbortedError extends AiError {
  constructor() {
    super('ai_aborted', 'AI request was aborted');
  }
}

/** The total time budget for the chain walk ran out. */
export class AiTimeoutError extends AiError {
  constructor() {
    super('ai_timeout', 'AI request timed out');
  }
}

/** A stream failed after deltas were already delivered, so it cannot fall through. */
export class AiStreamInterruptedError extends AiError {
  readonly info: AnswerInfo;
  constructor(info: AnswerInfo, cause?: unknown) {
    super('ai_stream_interrupted', 'AI stream was interrupted', { cause });
    this.info = info;
  }
}

export interface Classification {
  result: AttemptResult;
  status?: number;
  fallthrough: boolean;
  retryAfterMs?: number;
  /** Cooldown to apply; undefined means none. */
  cooldownMs?: number;
  /** 'account' cools every model of the entry (bad key, no credit). */
  scope: 'model' | 'account';
  /** Short machine code from the provider body (never the message). */
  errorType?: string;
}

interface ErrorLike {
  status?: unknown;
  headers?: unknown;
  error?: unknown;
  message?: unknown;
  name?: unknown;
  code?: unknown;
  cause?: unknown;
}

const DAILY_RE = /per[\s_-]?day|perday|daily|\bRPD\b|\bTPD\b|quota_exceeded/i;
const CREDIT_RE =
  /credit balance|insufficient[_\s](?:credit|funds|balance)|billing|payment required|purchase credits/i;
const MODEL_UNAVAILABLE_RE =
  /model_not_found|model_decommissioned|unknown model|model\b[^.]{0,120}\b(?:not found|does not exist|unavailable|not available|decommissioned|no longer|not supported|is not enabled|not enabled)/i;

function bodyText(e: ErrorLike): string {
  let body: string;
  try {
    body = e.error === undefined ? '' : JSON.stringify(e.error);
  } catch {
    body = '';
  }
  return `${typeof e.message === 'string' ? e.message : ''} ${body}`;
}

function errorType(e: ErrorLike): string | undefined {
  const err = e.error as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
  const first = Array.isArray(err) ? err[0] : err;
  const inner = (first?.['error'] ?? first) as Record<string, unknown> | undefined;
  const t = inner?.['type'] ?? inner?.['status'] ?? inner?.['code'];
  return typeof t === 'string' ? t.slice(0, 64) : typeof t === 'number' ? String(t) : undefined;
}

function isTimeoutLike(e: ErrorLike): boolean {
  const name = typeof e.name === 'string' ? e.name : '';
  return name === 'APIConnectionTimeoutError' || name === 'TimeoutError' || e.code === 'ETIMEDOUT';
}

function isNetworkLike(e: ErrorLike): boolean {
  const name = typeof e.name === 'string' ? e.name : '';
  if (name === 'APIConnectionError' || name === 'FetchError') return true;
  if (e instanceof TypeError) return true; // fetch() network failure
  const code = typeof e.code === 'string' ? e.code : '';
  return /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_)/.test(code);
}

/**
 * Decide what to do with a failed attempt.
 * Fall through: 429, 5xx/529, timeouts, network errors, 401/403, 402, 404 or "model unavailable",
 * credit-exhausted 400s. Surface: every other 4xx (our own bad request).
 */
export function classifyError(err: unknown, nowMs: number = Date.now()): Classification {
  const e = (typeof err === 'object' && err !== null ? err : { message: String(err) }) as ErrorLike;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const text = bodyText(e);
  const retryAfterMs = parseRetryAfterMs(e.headers as never, text, nowMs);
  const type = errorType(e);
  const base = { status, retryAfterMs, errorType: type };

  if (status === undefined) {
    if (isTimeoutLike(e)) return { ...base, result: 'timeout', fallthrough: true, scope: 'model' };
    if (isNetworkLike(e))
      return { ...base, result: 'network_error', fallthrough: true, scope: 'model' };
    // Unknown non-HTTP failure (SDK parse error, etc.): treat as a provider fault.
    return { ...base, result: 'server_error', fallthrough: true, scope: 'model' };
  }

  if (status === 429) {
    if (DAILY_RE.test(text)) {
      return {
        ...base,
        result: 'quota_exhausted',
        fallthrough: true,
        scope: 'model',
        cooldownMs: retryAfterMs ?? DAILY_QUOTA_COOLDOWN_MS,
      };
    }
    return {
      ...base,
      result: 'rate_limited',
      fallthrough: true,
      scope: 'model',
      cooldownMs: retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS,
    };
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      result: 'auth_error',
      fallthrough: true,
      scope: 'account',
      cooldownMs: retryAfterMs ?? AUTH_COOLDOWN_MS,
    };
  }
  if (status === 402 || (status === 400 && CREDIT_RE.test(text))) {
    return {
      ...base,
      result: 'credit_exhausted',
      fallthrough: true,
      scope: 'account',
      cooldownMs: retryAfterMs ?? AUTH_COOLDOWN_MS,
    };
  }
  if (status === 404 || ((status === 400 || status === 422) && MODEL_UNAVAILABLE_RE.test(text))) {
    return {
      ...base,
      result: 'model_unavailable',
      fallthrough: true,
      scope: 'model',
      cooldownMs: retryAfterMs ?? MODEL_UNAVAILABLE_COOLDOWN_MS,
    };
  }
  if (status === 408) return { ...base, result: 'timeout', fallthrough: true, scope: 'model' };
  if (status >= 500) {
    return {
      ...base,
      result: 'server_error',
      fallthrough: true,
      scope: 'model',
      ...(retryAfterMs !== undefined ? { cooldownMs: retryAfterMs } : {}),
    };
  }
  return { ...base, result: 'bad_request', fallthrough: false, scope: 'model' };
}

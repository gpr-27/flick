/**
 * Every failure the preview pipeline can produce. Codes are stable: they are
 * cached (negative cache), logged and asserted on in tests.
 */
export const LINK_PREVIEW_ERROR_CODES = [
  'INVALID_URL',
  'BLOCKED_SCHEME',
  'BLOCKED_PORT',
  'BLOCKED_CREDENTIALS',
  'BLOCKED_HOST',
  'BLOCKED_ADDRESS',
  'DNS_FAILURE',
  'TOO_MANY_REDIRECTS',
  'TIMEOUT',
  'TOO_LARGE',
  'UNSUPPORTED_CONTENT_TYPE',
  'UNSUPPORTED_ENCODING',
  'HTTP_ERROR',
  'NETWORK_ERROR',
  'NO_METADATA',
] as const;

export type LinkPreviewErrorCode = (typeof LINK_PREVIEW_ERROR_CODES)[number];

export class LinkPreviewError extends Error {
  override readonly name = 'LinkPreviewError';
  readonly code: LinkPreviewErrorCode;

  constructor(code: LinkPreviewErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.code = code;
  }
}

export function isLinkPreviewError(err: unknown): err is LinkPreviewError {
  return err instanceof LinkPreviewError;
}

export function isLinkPreviewErrorCode(value: unknown): value is LinkPreviewErrorCode {
  return (
    typeof value === 'string' && (LINK_PREVIEW_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Walks an error's `cause` chain looking for a LinkPreviewError. undici and
 * net wrap errors thrown from the custom `lookup`, so the original policy
 * error is usually one or two levels deep.
 */
export function findLinkPreviewError(err: unknown): LinkPreviewError | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current != null; depth++) {
    if (current instanceof LinkPreviewError) return current;
    if (typeof current === 'object' && 'cause' in current) {
      current = current.cause;
    } else {
      return undefined;
    }
  }
  return undefined;
}

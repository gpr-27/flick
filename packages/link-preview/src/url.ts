import { createHash } from 'node:crypto';
import { LinkPreviewError } from './errors.js';
import { isBlockedAddress, looksLikeIp, parseIpLiteral } from './ip.js';

export const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Names that never resolve to anything we should fetch. Checked before DNS. */
const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'localdomain',
  'local',
  'internal',
  'intranet',
  'lan',
  'home.arpa',
  'corp',
  'private',
];

export interface UrlPolicy {
  /** Test-only: permit ports other than 80/443. */
  readonly allowAnyPort?: boolean;
  /** Test-only: hostnames exempt from the reserved-suffix check. */
  readonly hostAllowlist?: ReadonlySet<string>;
}

/**
 * Parses and validates a user-supplied URL. Literal IP hosts are checked here
 * (Node's net layer skips `lookup` for literals); hostnames are checked again
 * after resolution by the pinned lookup in the fetcher.
 *
 * WHATWG URL parsing already canonicalises IPv4 tricks such as
 * `http://2130706433/`, `http://0x7f.1/` and `http://0177.0.0.1/` to
 * `127.0.0.1`, so the literal check sees the real address.
 */
export function validateUrl(input: string | URL, policy: UrlPolicy = {}): URL {
  const raw = typeof input === 'string' ? input.trim() : input.href;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new LinkPreviewError('INVALID_URL', 'URL is empty or too long');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkPreviewError('INVALID_URL', 'URL could not be parsed');
  }
  if (url.href.length > MAX_URL_LENGTH) {
    throw new LinkPreviewError('INVALID_URL', 'URL is too long');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new LinkPreviewError('BLOCKED_SCHEME', 'Only http and https are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new LinkPreviewError('BLOCKED_CREDENTIALS', 'URLs with credentials are not allowed');
  }
  if (!policy.allowAnyPort && !ALLOWED_PORTS.has(url.port)) {
    throw new LinkPreviewError('BLOCKED_PORT', 'Only ports 80 and 443 are allowed');
  }

  const host = url.hostname;
  if (host === '') throw new LinkPreviewError('INVALID_URL', 'URL has no host');

  if (looksLikeIp(host)) {
    // After WHATWG normalisation a literal is either canonical dotted-quad or
    // bracketed IPv6. Anything else is refused by isBlockedAddress.
    if (parseIpLiteral(host) === null || isBlockedAddress(host)) {
      throw new LinkPreviewError('BLOCKED_ADDRESS', 'Address is not publicly routable');
    }
    return url;
  }

  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (policy.hostAllowlist?.has(bare)) return url;
  if (!bare.includes('.')) {
    // Single-label names are resolved through search domains; refuse them.
    throw new LinkPreviewError('BLOCKED_HOST', 'Single-label hostnames are not allowed');
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (bare === suffix || bare.endsWith(`.${suffix}`)) {
      throw new LinkPreviewError('BLOCKED_HOST', 'Hostname is reserved for private use');
    }
  }
  return url;
}

/**
 * Normalised form used for the cache key: lower-cased scheme and host (done
 * by URL), default port dropped (done by URL), fragment removed, trailing
 * dot on the host removed.
 */
export function normalizeUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  if (copy.hostname.endsWith('.')) copy.hostname = copy.hostname.slice(0, -1);
  return copy.href;
}

export function cacheKeyFor(url: URL, variant = ''): string {
  const digest = createHash('sha256').update(normalizeUrl(url)).digest('hex');
  return variant === '' ? digest : `${digest}:${variant}`;
}

/** Host only, for logs. Never log paths or query strings. */
export function hostForLog(input: string | URL): string {
  try {
    const url = typeof input === 'string' ? new URL(input) : input;
    return url.hostname.slice(0, 253);
  } catch {
    return 'invalid';
  }
}

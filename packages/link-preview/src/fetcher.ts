import { promises as dnsPromises, type LookupAddress, type LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { Agent, request } from 'undici';
import { LinkPreviewError, findLinkPreviewError } from './errors.js';
import { familyOf, isBlockedAddress, isLoopbackAddress } from './ip.js';
import { validateUrl, type UrlPolicy } from './url.js';

export const DEFAULT_USER_AGENT =
  'ChatLinkPreview/1.0 (+link previews for an end-to-end encrypted chat app; fetches only public http(s) pages)';
export const DEFAULT_TOTAL_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 512 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Resolves a hostname to every address it has. Injected in tests. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/**
 * Test-only escape hatch so the suite can run against a local HTTP fixture.
 * Only the listed hostnames may resolve to loopback (nothing else private is
 * ever allowed, and IP literals such as 127.0.0.1 stay blocked). Refused when
 * NODE_ENV is "production".
 */
export interface TestOnlyFetcherOptions {
  readonly loopbackHosts: readonly string[];
  readonly allowAnyPort?: boolean;
}

export interface SafeFetcherOptions {
  readonly userAgent?: string;
  /** Wall-clock budget for the whole fetch, redirects and body included. */
  readonly totalTimeoutMs?: number;
  /** Default cap on (decompressed) body bytes. */
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly resolver?: Resolver;
  readonly testOnly?: TestOnlyFetcherOptions;
}

export interface FetchRequestOptions {
  /** Value sent as the Accept header. */
  readonly acceptHeader: string;
  /** Predicate on the lower-cased MIME type (no parameters). */
  readonly acceptMime: (mime: string) => boolean;
  readonly maxBytes?: number;
  /** "truncate" stops reading and returns what was read; "error" throws TOO_LARGE. */
  readonly onOversize: 'truncate' | 'error';
  /** Called once the final response's headers are accepted, before the body is read. */
  readonly onHeaders?: (info: {
    readonly finalUrl: URL;
    readonly mime: string;
    readonly charset: string | null;
  }) => void;
  /** Receives each decoded chunk. Return false to stop reading early. */
  readonly onChunk?: (chunk: Buffer) => boolean | undefined;
  /** Collect the body into `body`. */
  readonly collect?: boolean;
  readonly signal?: AbortSignal;
}

export interface FetchResult {
  readonly finalUrl: URL;
  readonly status: number;
  readonly mime: string;
  readonly charset: string | null;
  readonly bytesRead: number;
  readonly truncated: boolean;
  readonly redirects: number;
  readonly body: Buffer | null;
}

export interface SafeFetcher {
  /** URL policy in force (exposes test-only relaxations to the parser). */
  readonly urlPolicy: UrlPolicy;
  fetch(url: string | URL, options: FetchRequestOptions): Promise<FetchResult>;
  close(): Promise<void>;
}

const defaultResolver: Resolver = async (hostname) => {
  const results = await dnsPromises.lookup(hostname, { all: true, order: 'verbatim' });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

const noop = (): void => undefined;

/** Destroys a stream we no longer want without surfacing the resulting abort as an unhandled error. */
function discard(stream: Readable): void {
  stream.on('error', noop);
  if (!stream.destroyed) stream.destroy();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseContentType(value: string | undefined): { mime: string; charset: string | null } {
  if (value === undefined) return { mime: '', charset: null };
  const [type = '', ...params] = value.split(';');
  let charset: string | null = null;
  for (const param of params) {
    const [k, v] = param.split('=');
    if (k?.trim().toLowerCase() === 'charset' && v !== undefined) {
      charset = v.trim().replace(/^"|"$/g, '').toLowerCase().slice(0, 40);
    }
  }
  return { mime: type.trim().toLowerCase(), charset };
}

export function createSafeFetcher(options: SafeFetcherOptions = {}): SafeFetcher {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const defaultMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolver = options.resolver ?? defaultResolver;

  if (options.testOnly !== undefined && process.env.NODE_ENV === 'production') {
    throw new Error('link-preview: testOnly options are refused when NODE_ENV=production');
  }
  const loopbackHosts = new Set(
    (options.testOnly?.loopbackHosts ?? []).map((h) => h.toLowerCase()),
  );
  const urlPolicy: UrlPolicy = {
    allowAnyPort: options.testOnly?.allowAnyPort === true,
    hostAllowlist: loopbackHosts,
  };

  /**
   * Resolve once, validate every answer, and hand only validated addresses to
   * the socket. Because the socket connects to exactly what this returns,
   * there is no second resolution an attacker could rebind.
   */
  async function resolveSafely(rawHost: string): Promise<ResolvedAddress[]> {
    const host = rawHost
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
    let answers: readonly ResolvedAddress[];
    try {
      answers = await resolver(host);
    } catch (err) {
      throw new LinkPreviewError('DNS_FAILURE', 'Hostname could not be resolved', { cause: err });
    }
    if (answers.length === 0) {
      throw new LinkPreviewError('DNS_FAILURE', 'Hostname has no addresses');
    }
    const allowLoopback = loopbackHosts.has(host);
    const safe: ResolvedAddress[] = [];
    for (const answer of answers) {
      const family = familyOf(answer.address);
      const permitted =
        !isBlockedAddress(answer.address) || (allowLoopback && isLoopbackAddress(answer.address));
      // Fail closed on the whole answer set: a hostname that resolves to any
      // internal address is treated as hostile, even if a public one is
      // listed too (a classic rebinding/round-robin trick).
      if (family === null || !permitted) {
        throw new LinkPreviewError('BLOCKED_ADDRESS', 'Hostname resolves to a non-public address');
      }
      safe.push({ address: answer.address, family });
    }
    return safe;
  }

  const lookup: LookupFunction = (hostname, lookupOptions: LookupOptions, callback) => {
    resolveSafely(hostname).then(
      (addresses) => {
        const wanted = lookupOptions.family;
        const filtered =
          wanted === 4 || wanted === 6 ? addresses.filter((a) => a.family === wanted) : addresses;
        const first = filtered[0];
        if (first === undefined) {
          callback(new LinkPreviewError('DNS_FAILURE', 'No address for requested family'), '', 4);
          return;
        }
        if (lookupOptions.all === true) {
          const all: LookupAddress[] = filtered.map((a) => ({
            address: a.address,
            family: a.family,
          }));
          callback(null, all);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (err: unknown) => {
        callback(err as NodeJS.ErrnoException, '', 4);
      },
    );
  };

  const agent = new Agent({
    connect: { lookup, timeout: totalTimeoutMs },
    headersTimeout: totalTimeoutMs,
    bodyTimeout: totalTimeoutMs,
    keepAliveTimeout: 4_000,
    connections: 8,
  });

  async function readBody(
    body: Readable,
    encodingHeader: string | undefined,
    opts: FetchRequestOptions,
    maxBytes: number,
  ): Promise<{ bytesRead: number; truncated: boolean; body: Buffer | null }> {
    const encoding = (encodingHeader ?? 'identity').trim().toLowerCase();
    let stream: Readable;
    if (encoding === '' || encoding === 'identity') {
      stream = body;
    } else if (encoding === 'gzip' || encoding === 'x-gzip') {
      stream = pipeline(body, createGunzip(), () => undefined);
    } else if (encoding === 'br') {
      stream = pipeline(body, createBrotliDecompress(), () => undefined);
    } else {
      discard(body);
      throw new LinkPreviewError('UNSUPPORTED_ENCODING', 'Unsupported content-encoding');
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    try {
      for await (const raw of stream) {
        const chunk = raw as Buffer;
        const remaining = maxBytes - total;
        if (chunk.length > remaining) {
          truncated = true;
          if (opts.onOversize === 'error') {
            throw new LinkPreviewError('TOO_LARGE', 'Response body exceeds the size cap');
          }
          const piece = chunk.subarray(0, remaining);
          total += piece.length;
          if (piece.length > 0) {
            if (opts.collect === true) chunks.push(piece);
            opts.onChunk?.(piece);
          }
          break;
        }
        total += chunk.length;
        if (opts.collect === true) chunks.push(chunk);
        if (opts.onChunk?.(chunk) === false) break;
      }
    } finally {
      discard(stream);
      discard(body);
    }
    return {
      bytesRead: total,
      truncated,
      body: opts.collect === true ? Buffer.concat(chunks) : null,
    };
  }

  async function doFetch(
    input: string | URL,
    opts: FetchRequestOptions,
    signal: AbortSignal,
  ): Promise<FetchResult> {
    const maxBytes = opts.maxBytes ?? defaultMaxBytes;
    let current = validateUrl(input, urlPolicy);
    for (let redirects = 0; ; redirects++) {
      const res = await request(current, {
        method: 'GET',
        dispatcher: agent,
        signal,
        headers: {
          'user-agent': userAgent,
          accept: opts.acceptHeader,
          'accept-encoding': 'gzip, br',
          'accept-language': 'en;q=0.9, *;q=0.5',
        },
      });

      if (REDIRECT_STATUSES.has(res.statusCode)) {
        discard(res.body);
        const location = headerValue(res.headers.location);
        if (location === undefined || location === '') {
          throw new LinkPreviewError('HTTP_ERROR', 'Redirect without Location');
        }
        if (redirects >= maxRedirects) {
          throw new LinkPreviewError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new LinkPreviewError('INVALID_URL', 'Redirect Location could not be parsed');
        }
        // Every hop gets the full check again (scheme, port, credentials,
        // literal IPs); the pinned lookup re-validates resolved addresses.
        current = validateUrl(next, urlPolicy);
        continue;
      }

      if (res.statusCode < 200 || res.statusCode > 299) {
        discard(res.body);
        throw new LinkPreviewError('HTTP_ERROR', `Upstream answered ${res.statusCode}`);
      }

      const { mime, charset } = parseContentType(headerValue(res.headers['content-type']));
      if (!opts.acceptMime(mime)) {
        discard(res.body);
        throw new LinkPreviewError('UNSUPPORTED_CONTENT_TYPE', 'Content type not accepted');
      }

      const declared = Number(headerValue(res.headers['content-length']));
      if (opts.onOversize === 'error' && Number.isFinite(declared) && declared > maxBytes) {
        discard(res.body);
        throw new LinkPreviewError('TOO_LARGE', 'Declared content-length exceeds the size cap');
      }

      opts.onHeaders?.({ finalUrl: current, mime, charset });
      const read = await readBody(
        res.body,
        headerValue(res.headers['content-encoding']),
        opts,
        maxBytes,
      );
      return {
        finalUrl: current,
        status: res.statusCode,
        mime,
        charset,
        bytesRead: read.bytesRead,
        truncated: read.truncated,
        redirects,
        body: read.body,
      };
    }
  }

  return {
    urlPolicy,
    async fetch(input, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new LinkPreviewError('TIMEOUT', 'Fetch exceeded the time budget'));
      }, totalTimeoutMs);
      const signal =
        opts.signal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, opts.signal]);
      try {
        return await doFetch(input, opts, signal);
      } catch (err) {
        if (controller.signal.aborted)
          throw new LinkPreviewError('TIMEOUT', 'Fetch exceeded the time budget', { cause: err });
        const known = findLinkPreviewError(err);
        if (known !== undefined) throw known;
        const code = (err as { code?: unknown } | null)?.code;
        if (
          code === 'UND_ERR_HEADERS_TIMEOUT' ||
          code === 'UND_ERR_BODY_TIMEOUT' ||
          code === 'UND_ERR_CONNECT_TIMEOUT'
        ) {
          throw new LinkPreviewError('TIMEOUT', 'Upstream timed out', { cause: err });
        }
        throw new LinkPreviewError('NETWORK_ERROR', 'Upstream request failed', { cause: err });
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      await agent.close();
    },
  };
}

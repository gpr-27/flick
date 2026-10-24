import {
  NEGATIVE_TTL_SECONDS,
  PREVIEW_TTL_SECONDS,
  MemoryPreviewCache,
  type CacheEntry,
  type PreviewCache,
} from './cache.js';
import { LinkPreviewError, findLinkPreviewError } from './errors.js';
import { createSafeFetcher, type SafeFetcher, type SafeFetcherOptions } from './fetcher.js';
import { MetadataExtractor, type LinkPreview } from './parser.js';
import { cacheKeyFor, validateUrl } from './url.js';

export const DEFAULT_MAX_IMAGE_BYTES = 1024 * 1024;

const HTML_ACCEPT = 'text/html;q=1.0';
const IMAGE_ACCEPT = 'image/png, image/jpeg, image/gif, image/webp';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

export interface PreviewImage {
  /** Sniffed from the bytes, not taken from the upstream header. */
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  readonly data: Buffer;
}

export interface PreviewResult {
  readonly preview: LinkPreview;
  /** Present only when `fetchImage` was requested and the image passed every check. */
  readonly image?: PreviewImage;
  readonly cached: boolean;
}

export interface GetPreviewOptions {
  /** Also fetch og:image through the safe fetcher and return its bytes. */
  readonly fetchImage?: boolean;
}

export interface LinkPreviewServiceOptions {
  /** Pre-built fetcher; otherwise one is created from `fetcherOptions`. */
  readonly fetcher?: SafeFetcher;
  readonly fetcherOptions?: SafeFetcherOptions;
  readonly cache?: PreviewCache;
  readonly ttlSeconds?: number;
  readonly negativeTtlSeconds?: number;
  readonly maxImageBytes?: number;
}

export interface LinkPreviewService {
  getPreview(url: string, options?: GetPreviewOptions): Promise<PreviewResult>;
  close(): Promise<void>;
}

export function sniffImageType(data: Buffer): PreviewImage['contentType'] | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (data.length >= 6) {
    const sig = data.subarray(0, 6).toString('latin1');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function toResult(entry: CacheEntry & { ok: true }, cached: boolean): PreviewResult {
  if (entry.image === undefined) return { preview: entry.preview, cached };
  return {
    preview: entry.preview,
    cached,
    image: {
      contentType: entry.image.contentType as PreviewImage['contentType'],
      data: Buffer.from(entry.image.base64, 'base64'),
    },
  };
}

export function createLinkPreviewService(
  options: LinkPreviewServiceOptions = {},
): LinkPreviewService {
  const ownsFetcher = options.fetcher === undefined;
  const fetcher = options.fetcher ?? createSafeFetcher(options.fetcherOptions);
  const cache = options.cache ?? new MemoryPreviewCache();
  const ttl = options.ttlSeconds ?? PREVIEW_TTL_SECONDS;
  const negativeTtl = options.negativeTtlSeconds ?? NEGATIVE_TTL_SECONDS;
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const inflight = new Map<string, Promise<CacheEntry>>();

  async function fetchImage(imageUrl: string): Promise<PreviewImage | undefined> {
    try {
      const res = await fetcher.fetch(imageUrl, {
        acceptHeader: IMAGE_ACCEPT,
        acceptMime: (mime) => IMAGE_MIMES.has(mime),
        maxBytes: maxImageBytes,
        onOversize: 'error',
        collect: true,
      });
      if (res.body === null) return undefined;
      const type = sniffImageType(res.body);
      return type === null ? undefined : { contentType: type, data: res.body };
    } catch {
      // A broken image never fails the whole preview.
      return undefined;
    }
  }

  /**
   * Fetch + streaming parse. The extractor is created once headers arrive (so
   * it knows the declared charset) and stops the read as soon as the document
   * head is over.
   */
  async function computeEntry(url: URL, withImage: boolean): Promise<CacheEntry> {
    try {
      const parts: { extractor: MetadataExtractor | null } = { extractor: null };
      const res = await fetcher.fetch(url, {
        acceptHeader: HTML_ACCEPT,
        acceptMime: (mime) => mime === 'text/html',
        onOversize: 'truncate',
        onHeaders: (info) => {
          parts.extractor = new MetadataExtractor(info.charset);
        },
        onChunk: (chunk) => {
          const ex = parts.extractor;
          if (ex === null) return false;
          ex.write(chunk);
          return !ex.done;
        },
      });
      const extractor = parts.extractor ?? new MetadataExtractor(res.charset);
      const preview = extractor.finish(res.finalUrl, fetcher.urlPolicy);
      if (preview.title === null && preview.description === null && preview.imageUrl === null) {
        return { ok: false, code: 'NO_METADATA' };
      }
      if (withImage && preview.imageUrl !== null) {
        const image = await fetchImage(preview.imageUrl);
        if (image !== undefined) {
          return {
            ok: true,
            preview,
            image: { contentType: image.contentType, base64: image.data.toString('base64') },
          };
        }
      }
      return { ok: true, preview };
    } catch (err) {
      const known = findLinkPreviewError(err);
      return { ok: false, code: known?.code ?? 'NETWORK_ERROR' };
    }
  }

  async function safeCacheGet(key: string): Promise<CacheEntry | null> {
    try {
      return await cache.get(key);
    } catch {
      return null; // cache outage degrades to a live fetch
    }
  }

  async function safeCacheSet(key: string, entry: CacheEntry): Promise<void> {
    try {
      await cache.set(key, entry, entry.ok ? ttl : negativeTtl);
    } catch {
      // ignore: cache is an optimisation, not a correctness boundary
    }
  }

  return {
    async getPreview(input, opts = {}) {
      // Policy violations on the submitted URL are cheap to detect and are
      // thrown without touching the cache.
      const url = validateUrl(input, fetcher.urlPolicy);
      const withImage = opts.fetchImage === true;
      const key = cacheKeyFor(url, withImage ? 'img' : '');

      const cachedEntry = await safeCacheGet(key);
      if (cachedEntry !== null) {
        if (!cachedEntry.ok) throw new LinkPreviewError(cachedEntry.code, 'Cached failure');
        return toResult(cachedEntry, true);
      }

      let pending = inflight.get(key);
      if (pending === undefined) {
        pending = computeEntry(url, withImage).then(async (entry) => {
          await safeCacheSet(key, entry);
          return entry;
        });
        const tracked = pending.finally(() => inflight.delete(key));
        inflight.set(key, tracked);
        pending = tracked;
      }
      const entry = await pending;
      if (!entry.ok) throw new LinkPreviewError(entry.code, 'Preview unavailable');
      return toResult(entry, false);
    },
    async close() {
      if (ownsFetcher) await fetcher.close();
    },
  };
}

import type { Redis } from 'ioredis';
import { z } from 'zod';
import { LINK_PREVIEW_ERROR_CODES, type LinkPreviewErrorCode } from './errors.js';
import type { LinkPreview } from './parser.js';

export const PREVIEW_TTL_SECONDS = 24 * 60 * 60;
export const NEGATIVE_TTL_SECONDS = 60 * 60;

/** JSON-safe image representation used inside cache entries. */
export interface CachedImage {
  readonly contentType: string;
  readonly base64: string;
}

export type CacheEntry =
  | { readonly ok: true; readonly preview: LinkPreview; readonly image?: CachedImage }
  | { readonly ok: false; readonly code: LinkPreviewErrorCode };

/**
 * Storage for previews and negative results. Keys are opaque (the service
 * passes sha256(normalised URL) plus a variant suffix).
 */
export interface PreviewCache {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void>;
}

const nullableString = z.string().nullable();
const entrySchema = z.union([
  z.object({
    ok: z.literal(true),
    preview: z.object({
      url: z.string(),
      title: nullableString,
      description: nullableString,
      siteName: nullableString,
      imageUrl: nullableString,
    }),
    image: z.object({ contentType: z.string(), base64: z.string() }).optional(),
  }),
  z.object({ ok: z.literal(false), code: z.enum(LINK_PREVIEW_ERROR_CODES) }),
]);

function parseEntry(raw: string): CacheEntry | null {
  try {
    const result = entrySchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    const value = result.data;
    if (!value.ok) return { ok: false, code: value.code };
    return value.image === undefined
      ? { ok: true, preview: value.preview }
      : { ok: true, preview: value.preview, image: value.image };
  } catch {
    return null;
  }
}

export interface MemoryPreviewCacheOptions {
  readonly maxEntries?: number;
  /** Approximate cap on stored bytes (JSON length). */
  readonly maxBytes?: number;
  readonly now?: () => number;
}

/** Process-local LRU with per-entry expiry. Suitable for tests and single-node dev. */
export class MemoryPreviewCache implements PreviewCache {
  private readonly entries = new Map<string, { raw: string; expiresAt: number }>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: MemoryPreviewCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Promise<CacheEntry | null> {
    const hit = this.entries.get(key);
    if (hit === undefined) return Promise.resolve(null);
    if (hit.expiresAt <= this.now()) {
      this.remove(key);
      return Promise.resolve(null);
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return Promise.resolve(parseEntry(hit.raw));
  }

  set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(entry);
    if (raw.length > this.maxBytes) return Promise.resolve();
    this.remove(key);
    this.entries.set(key, { raw, expiresAt: this.now() + ttlSeconds * 1000 });
    this.bytes += raw.length;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.remove(oldest.value);
    }
    return Promise.resolve();
  }

  private remove(key: string): void {
    const existing = this.entries.get(key);
    if (existing === undefined) return;
    this.bytes -= existing.raw.length;
    this.entries.delete(key);
  }
}

export type RedisLike = Pick<Redis, 'get' | 'set'>;

export interface RedisPreviewCacheOptions {
  readonly keyPrefix?: string;
}

/** Redis-backed cache (ioredis). Entries expire via Redis TTLs. */
export class RedisPreviewCache implements PreviewCache {
  private readonly prefix: string;

  constructor(
    private readonly redis: RedisLike,
    options: RedisPreviewCacheOptions = {},
  ) {
    this.prefix = options.keyPrefix ?? 'linkpreview:';
  }

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(this.prefix + key);
    return raw === null ? null : parseEntry(raw);
  }

  async set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      this.prefix + key,
      JSON.stringify(entry),
      'EX',
      Math.max(1, Math.floor(ttlSeconds)),
    );
  }
}

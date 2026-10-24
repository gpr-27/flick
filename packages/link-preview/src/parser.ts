import { TextDecoder } from 'node:util';
import { Parser } from 'htmlparser2';
import { FIELD_LIMITS, sanitizeText, sanitizeUrl } from './sanitize.js';
import type { UrlPolicy } from './url.js';

export interface LinkPreview {
  /** Canonical URL (same-site canonical/og:url) or the final fetched URL. */
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  readonly imageUrl: string | null;
}

const META_KEYS = new Set([
  'og:title',
  'og:description',
  'og:site_name',
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'og:url',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:image:src',
  'description',
  'application-name',
]);

/** Raw text gathered per field is capped well before sanitising. */
const MAX_RAW_FIELD = 8_192;
const MAX_TITLE_RAW = 2_048;

function firstDefined(...values: (string | undefined)[]): string | undefined {
  for (const v of values) if (v !== undefined && v.trim() !== '') return v;
  return undefined;
}

function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => (h.startsWith('www.') ? h.slice(4) : h);
  return strip(a.hostname) === strip(b.hostname);
}

function sniffCharset(head: Buffer): string | null {
  const text = head.subarray(0, 1024).toString('latin1');
  const match = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]{1,40})/i.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

function makeDecoder(charset: string | null): TextDecoder {
  try {
    return new TextDecoder(charset ?? 'utf-8', { fatal: false });
  } catch {
    return new TextDecoder('utf-8', { fatal: false });
  }
}

/**
 * Streaming metadata extractor. Feed it raw body bytes with `write`; it
 * reports `done` once the document head is over, so the fetcher can stop
 * reading early.
 */
export class MetadataExtractor {
  private readonly meta = new Map<string, string>();
  private title = '';
  private inTitle = false;
  private sawTitle = false;
  private canonical: string | undefined;
  private baseHref: string | undefined;
  private decoder: TextDecoder | undefined;
  private finished = false;
  private readonly parser: Parser;

  constructor(private readonly headerCharset: string | null) {
    this.parser = new Parser(
      {
        onopentag: (name, attribs) => {
          this.onOpenTag(name, attribs);
        },
        ontext: (text) => {
          if (this.inTitle && this.title.length < MAX_TITLE_RAW) this.title += text;
        },
        onclosetag: (name) => {
          if (name === 'title') this.inTitle = false;
          if (name === 'head') this.finished = true;
        },
      },
      { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
    );
  }

  get done(): boolean {
    return this.finished;
  }

  private onOpenTag(name: string, attribs: Record<string, string>): void {
    if (this.finished) return;
    switch (name) {
      case 'body':
        this.finished = true;
        return;
      case 'title':
        if (!this.sawTitle) {
          this.sawTitle = true;
          this.inTitle = true;
        }
        return;
      case 'base':
        if (this.baseHref === undefined && attribs.href !== undefined) this.baseHref = attribs.href;
        return;
      case 'link': {
        const rel = (attribs.rel ?? '').toLowerCase().split(/\s+/);
        if (
          rel.includes('canonical') &&
          this.canonical === undefined &&
          attribs.href !== undefined
        ) {
          this.canonical = attribs.href.slice(0, MAX_RAW_FIELD);
        }
        return;
      }
      case 'meta': {
        const key = (attribs.property ?? attribs.name ?? '').trim().toLowerCase();
        const content = attribs.content;
        if (META_KEYS.has(key) && content !== undefined && !this.meta.has(key)) {
          this.meta.set(key, content.slice(0, MAX_RAW_FIELD));
        }
        return;
      }
      default:
        return;
    }
  }

  write(chunk: Buffer): void {
    if (this.finished) return;
    this.decoder ??= makeDecoder(this.headerCharset ?? sniffCharset(chunk));
    this.parser.write(this.decoder.decode(chunk, { stream: true }));
  }

  /**
   * Builds the preview. `pageUrl` is the final URL after redirects; `policy`
   * is the URL policy used to vet image and canonical URLs.
   */
  finish(pageUrl: URL, policy: UrlPolicy = {}): LinkPreview {
    if (this.decoder !== undefined && !this.finished) {
      this.parser.write(this.decoder.decode());
    }
    this.parser.end();

    const m = (k: string) => this.meta.get(k);
    const base = sanitizeUrl(this.baseHref, pageUrl, { ...policy, allowAnyPort: true }) ?? pageUrl;

    let url = pageUrl;
    const canonical = sanitizeUrl(firstDefined(this.canonical, m('og:url')), base, policy);
    // A page may only claim a canonical URL on its own site; otherwise a
    // hostile page could make its preview show someone else's address.
    if (canonical !== null && sameSite(canonical, pageUrl)) url = canonical;

    const image = sanitizeUrl(
      firstDefined(
        m('og:image:secure_url'),
        m('og:image'),
        m('og:image:url'),
        m('twitter:image'),
        m('twitter:image:src'),
      ),
      base,
      policy,
    );

    const titleRaw = firstDefined(m('og:title'), m('twitter:title'), this.title);
    return {
      url: url.href.slice(0, FIELD_LIMITS.url),
      title: sanitizeText(titleRaw, FIELD_LIMITS.title),
      description: sanitizeText(
        firstDefined(m('og:description'), m('twitter:description'), m('description')),
        FIELD_LIMITS.description,
      ),
      siteName: sanitizeText(
        firstDefined(m('og:site_name'), m('application-name')),
        FIELD_LIMITS.siteName,
      ),
      imageUrl: image?.href ?? null,
    };
  }
}

/** Convenience for tests and callers that already hold the HTML. */
export function parseHtml(
  html: string | Buffer,
  pageUrl: URL,
  charset: string | null = null,
  policy: UrlPolicy = {},
): LinkPreview {
  const extractor = new MetadataExtractor(charset ?? (typeof html === 'string' ? 'utf-8' : null));
  extractor.write(typeof html === 'string' ? Buffer.from(html, 'utf8') : html);
  return extractor.finish(pageUrl, policy);
}

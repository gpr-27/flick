import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isBlockedAddress } from '@chat/link-preview';

// "Read links": fetch a page the user pasted to Flick, so it can be summarised. The page is
// untrusted: only http(s), never a private/loopback address (checked when the socket connects, so
// DNS tricks and redirects are covered), 5 s, 1 MB, text only. Returns plain text.

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
export const MAX_PAGE_CHARS = 6_000;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** The first http(s) link in a message, or null. */
export function firstUrl(text: string): string | null {
  const m = text.match(URL_RE)?.[0];
  return m ? m.replace(/[.,;:!?]+$/, '') : null;
}

/** Looks the host up and refuses any private / loopback / link-local answer. */
const safeLookup: typeof dnsLookup = ((host: string, options: unknown, cb: unknown) => {
  const done = cb as (err: Error | null, address?: unknown, family?: number) => void;
  const opts = (typeof options === 'object' && options ? options : {}) as { all?: boolean };
  dnsLookup(host, { all: true }, (err, addresses) => {
    if (err) return done(err);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return done(new Error('blocked address'));
    }
    if (opts.all) return done(null, addresses);
    return done(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as typeof dnsLookup;

function get(url: URL): Promise<{ status: number; location?: string; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        headers: { 'user-agent': 'FlickBot/1.0', accept: 'text/html,text/plain;q=0.9' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers['content-type'] ?? '').toLowerCase();
        const location =
          typeof res.headers.location === 'string' ? res.headers.location : undefined;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, type, body: Buffer.alloc(0) });
        }
        if (!/^text\/|application\/(xhtml\+xml|json)/.test(type)) {
          res.destroy();
          return reject(new Error('not text'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            res.destroy();
            resolve({ status, type, body: Buffer.concat(chunks) }); // keep the first 1 MB
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ status, type, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    // Hard deadline for the whole request, slow drip included.
    setTimeout(() => req.destroy(new Error('timeout')), TIMEOUT_MS).unref();
    req.end();
  });
}

/** HTML to readable text: drops scripts and styles, tags and extra whitespace. */
export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const body = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return (title ? `${title}\n` : '') + body;
}

/** The text of the page at `link`, or null if it cannot be fetched safely. Never throws. */
export async function fetchPageText(link: string): Promise<string | null> {
  try {
    let url = new URL(link);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      // An IP written in the link skips the DNS lookup, so check it here.
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host) && isBlockedAddress(host)) return null;
      const res = await get(url);
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = new URL(res.location, url); // the next hop is checked by safeLookup again
        continue;
      }
      if (res.status < 200 || res.status >= 300) return null;
      const raw = res.body.toString('utf8');
      const text = res.type.includes('html') ? htmlToText(raw) : raw.replace(/\s+/g, ' ').trim();
      return text.slice(0, MAX_PAGE_CHARS) || null;
    }
    return null;
  } catch {
    return null;
  }
}

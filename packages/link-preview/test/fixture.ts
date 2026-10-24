import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createSafeFetcher,
  type ResolvedAddress,
  type SafeFetcher,
  type SafeFetcherOptions,
} from '../src/fetcher.js';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface Fixture {
  readonly port: number;
  /** Base URL using a test hostname that the mock resolver maps to loopback. */
  url(path: string, host?: string): string;
  route(path: string, handler: Handler): void;
  readonly hits: { path: string; host: string | undefined; userAgent: string | undefined }[];
  close(): Promise<void>;
}

export async function startFixture(): Promise<Fixture> {
  const routes = new Map<string, Handler>();
  const hits: Fixture['hits'] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    hits.push({ path, host: req.headers.host, userAgent: req.headers['user-agent'] });
    const handler = routes.get(path);
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    hits,
    url: (path, host = 'fixture.test') => `http://${host}:${port}${path}`,
    route: (path, handler) => routes.set(path, handler),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export type ResolverTable = Record<string, string[] | ((call: number) => string[])>;

export function mockResolver(table: ResolverTable) {
  const calls: string[] = [];
  const resolver = (hostname: string): Promise<ResolvedAddress[]> => {
    calls.push(hostname);
    const entry = table[hostname];
    if (entry === undefined) return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
    const n = calls.filter((h) => h === hostname).length;
    const list = typeof entry === 'function' ? entry(n) : entry;
    return Promise.resolve(
      list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
  return { resolver, calls };
}

/** Fetcher wired to the fixture through the explicit test-only loopback allowlist. */
export function fixtureFetcher(
  table: ResolverTable = {},
  extra: Partial<SafeFetcherOptions> = {},
): {
  fetcher: SafeFetcher;
  calls: string[];
} {
  const { resolver, calls } = mockResolver({ 'fixture.test': ['127.0.0.1'], ...table });
  const fetcher = createSafeFetcher({
    resolver,
    testOnly: { loopbackHosts: ['fixture.test', 'rebind.test'], allowAnyPort: true },
    ...extra,
  });
  return { fetcher, calls };
}

export const HTML = (head: string, body = '<p>hello</p>') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

export function html(
  res: ServerResponse,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);
}

export const htmlAccept = {
  acceptHeader: 'text/html',
  acceptMime: (mime: string) => mime === 'text/html',
  onOversize: 'truncate' as const,
  collect: true,
};

# @chat/link-preview

Server-side link previews for the chat app.

When a sender types a URL, the **sender's device** asks our server to fetch the page
(`GET /link-preview?url=…`). The device then attaches the returned
`{url, title, description, siteName, imageUrl}` to the message it sends.
Recipients never fetch anything for a preview.

That makes this endpoint an open, authenticated **URL-fetching proxy running
inside our network**, which is the largest SSRF surface in the system. The
package is built around that fact.

```
client ──GET /link-preview?url=──▶ authGuard ─▶ rateLimit ─▶ zod ─▶ service
                                                                     │
                                       cache (sha256(normalised URL))│ single-flight
                                                                     ▼
                                    validateUrl ─▶ undici Agent (pinned lookup) ─▶ internet
                                                                     │
                                                streaming htmlparser2 ─▶ sanitise ─▶ JSON
```

## Usage

```ts
import { Redis } from 'ioredis';
import {
  createLinkPreviewService,
  linkPreviewRoutes,
  RedisPreviewCache,
} from '@chat/link-preview';

const service = createLinkPreviewService({
  cache: new RedisPreviewCache(new Redis(config.REDIS_URL)),
});

await app.register(linkPreviewRoutes, {
  service,
  authGuard: app.requireUser, // async (req, reply) => { … return reply.code(401).send() }
  rateLimit: app.rateLimit('link-preview'), // async (req, reply) => { … return reply.code(429).send() }
});

app.addHook('onClose', () => service.close());
```

### Route contract

`GET /link-preview?url=<absolute http(s) URL>[&image=1]`

| Status | Body |
| --- | --- |
| 200 | `{ preview: { url, title, description, siteName, imageUrl }, image?: { contentType, base64 } }` |
| 400 | `{ error: "invalid_request" }`: malformed query, non-http(s) scheme, credentials in the URL, or a bad port |
| 401 / 429 | whatever the supplied `authGuard` / `rateLimit` hooks send |
| 422 | `{ error: "preview_unavailable" }` for **every** fetch or policy failure |

Every field except `url` may be `null`. The response carries `Cache-Control: no-store`.

### Library API

- `createSafeFetcher(opts)` is the hardened HTTP client. You can reuse it for any other server-side fetch of a user-supplied URL.
- `createLinkPreviewService({ fetcher?, fetcherOptions?, cache?, ttlSeconds?, negativeTtlSeconds?, maxImageBytes? })` has `getPreview(url, { fetchImage? })` and `close()`.
- `PreviewCache` is the cache interface, with two implementations: `MemoryPreviewCache` (an LRU with a byte cap) and `RedisPreviewCache` (ioredis).
- `parseHtml` / `MetadataExtractor`: the streaming parser on its own.
- `isBlockedAddress`, `validateUrl`, `normalizeUrl`, `cacheKeyFor`: the policy primitives.

## Threat model

**Attacker:** any authenticated user (or anyone holding a stolen session).
They control the submitted URL, the DNS records for any domain they own, and
the HTTP server behind it (status codes, headers, redirects, body, timing).

**Assets:**
- Internal services: Postgres, Redis, Redpanda, MinIO, the admin and metrics endpoints, the Docker host.
- The cloud metadata service at 169.254.169.254, where IAM credentials live.
- Anything reachable on RFC1918, CGNAT or IPv6 ULA networks.
- Server resources: sockets, memory and CPU.
- The privacy of URLs that users share.
- The integrity of what recipients see.

### Threats and mitigations

| # | Threat | Mitigation |
| --- | --- | --- |
| 1 | **Direct internal target** (`http://10.0.0.5:6379/`, `http://169.254.169.254/…`) | `validateUrl` allows only `http:` and `https:`, only ports 80 and 443 (the default ports), and no userinfo. Literal IPs are checked against the block list before any socket is opened. |
| 2 | **IP literal obfuscation** (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`, full-width digits, `[::ffff:127.0.0.1]`, `[64:ff9b::a9fe:a9fe]`) | The WHATWG URL parser canonicalises every IPv4 spelling to dotted-quad before the check. `isBlockedAddress` accepts only canonical text and fails closed on anything else. |
| 3 | **Hostname that resolves to an internal IP** (`evil.com A 127.0.0.1`, `*.nip.io`) | DNS goes through a custom `connect.lookup` on the undici `Agent`. Every answer is checked, and if **any** answer is blocked the whole name is refused, which also defeats round-robin mixes. Names such as `localhost`, `*.local`, `*.internal`, `*.home.arpa` and single-label hosts are refused before DNS. |
| 4 | **DNS rebinding / TOCTOU** (first answer public, second answer internal) | There is no separate "check" resolution. The lookup that vets the addresses is the lookup the socket uses, so the connection goes to exactly the IP that was checked (the `Host` header and SNI keep the original name). Every new connection, including each redirect hop and every reconnect, resolves and checks again. |
| 5 | **Redirect to an internal target** (`302 Location: http://127.0.0.1/`, `file://`, credentials) | Redirects are followed manually (at most 3), and every `Location` goes through `validateUrl` plus the pinned lookup again. |
| 6 | **IPv6 and transition-mechanism bypasses** | The following are refused: IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`), IPv4-translated, NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), 6to4 (`2002::/16`), Teredo (`2001::/32`), ULA (`fc00::/7`), link-local (`fe80::/10`), site-local, multicast, documentation (`2001:db8::/32`, `3fff::/20`) and discard. IPv6 must also fall inside global unicast `2000::/3`. Mapped forms are refused outright, never unwrapped. |
| 7 | **Resource exhaustion** (slowloris, huge bodies, gzip and brotli bombs, many redirects) | A 5 s wall-clock budget covers DNS, connect, every hop and the body. HTML reading stops at 512 KiB of *decompressed* bytes; images are capped at 1 MiB, and a declared or streamed overflow is an error. Only `identity`, `gzip` and `br` encodings are accepted. Parsing stops at `</head>` or `<body>`. |
| 8 | **Content confusion** (JSON, SVG with script, `text/html-sandboxed`) | Only the exact MIME `text/html` is parsed. Images must be PNG, JPEG, GIF or WebP: the MIME header is checked **and** the magic bytes are sniffed, and the sniffed type is what gets returned. |
| 9 | **Malicious metadata** (XSS payloads, bidi-override spoofing such as `‮gnp.exe`, megabyte titles) | Every field is entity-decoded, NFC-normalised, and stripped of tags, C0/C1 controls, zero-width and bidi-control characters. Whitespace is collapsed and each field is capped (title 300, description 1000, site name 100, URLs 2048). Clients **must still render these as plain text.** |
| 10 | **Preview spoofing** (a page claims `canonical = https://bank.example/`) | A canonical URL or `og:url` is honoured only on the same site as the fetched page (ignoring `www.`). Otherwise the preview shows the final fetched URL. |
| 11 | **Internal URLs smuggled to recipients** (`og:image = http://192.168.1.1/…`) | Image and canonical URLs go through the same `validateUrl` policy, and anything private is dropped. To keep recipients off third-party hosts entirely, request `image=1` so the sender embeds the image bytes. |
| 12 | **Network-mapping oracle** (telling "blocked" from "DNS failed" from "timeout") | Every failure returns the same `422 preview_unavailable`. The specific code is logged server-side only. |
| 13 | **URL privacy in logs** (shared links can carry secrets such as reset tokens) | Logs carry the **host only**. Fastify's built-in request and response lines for this route run at `warn` level because they include the query string. Host apps must not log query strings in global hooks either. |
| 14 | **Abuse as an anonymous proxy or DoS amplifier** | `authGuard` and `rateLimit` are **required** options and run in `onRequest`, before any parsing. Results are cached for 24 h; failures are cached for 1 h, so hammering a dead or blocked URL costs one fetch per hour. Concurrent requests for the same URL share one in-flight fetch. |
| 15 | **Environment proxies** (`HTTP_PROXY` pointing inside the network) | The fetcher always uses its own undici `Agent`, so proxy environment variables are ignored. |

### Cache

- The key is `sha256(normalised URL)`. Normalising lower-cases the scheme and host, drops the default port, the fragment and any trailing host dot. Requests with an image get a `:img` suffix on the key.
- Successful previews live for 24 h. Failures (any `LinkPreviewError` code) are cached for 1 h.
- Policy violations on the *submitted* URL are rejected synchronously and never cached.
- Cache errors fall back to a live fetch: the cache is an optimisation, not a security boundary.
- Single-flight works within one process. Across instances, the shared Redis cache limits duplicate fetches to the length of one fetch.

### Testing against a local server

Tests need a loopback HTTP fixture, which the policy would normally block.
`createSafeFetcher({ testOnly: { loopbackHosts: ['fixture.test'], allowAnyPort: true }, resolver })`
lets **only the listed hostnames** resolve to **loopback only**. IP literals
such as `127.0.0.1` stay blocked, which is how the "redirect to 127.0.0.1"
test works. The option throws when `NODE_ENV=production`, and the service and
route expose no way to set it from a request.

`test/cache.test.ts` runs the `RedisPreviewCache` suite against a real Redis
when `TEST_REDIS_URL` is set, and skips it otherwise.

### Residual risks and non-goals

- **Public-but-sensitive targets.** The proxy can reach anything on the public internet, including our own public endpoints. Those must have their own authentication.
- **Egress controls.** Run the API with a network policy or security group that denies egress to private ranges and the metadata IP. Use IMDSv2 with a hop limit of 1 where available. This package is one layer, not the only one.
- **Charset sniffing** reads only the `Content-Type` charset or a `<meta charset>` in the first 1 KiB. Exotic encodings fall back to UTF-8.
- **The sender is trusted with its own preview.** A modified client can put anything into the message, whatever this server returned. Recipients' clients must treat preview fields as untrusted plain text.

# Architecture Decision Records

One short record per design choice: context, decision, alternatives, trade-offs, consequences. Records 0001 to 0015 describe the core platform; 0016 to 0026 describe the AI layer, uploads, albums, sign-in, Markdown, the redesign, phone Back navigation, transcription limits and wallpapers. Records are kept even when later work refines them (the later record says so).

Related: [`../architecture/overview.md`](../architecture/overview.md), [`../status.md`](../status.md), [`../README.md`](../README.md).

**Status values:** _Accepted_ means decided. _Superseded_ means replaced. Every record below is _Accepted_ and matches the
current code. What has been verified is in [`../status.md`](../status.md).

**The rule for deferred things:** add them only when a need is shown. Redpanda/Kafka, end-to-end encryption, and
sharding or multi-region are deferred this way.

| ADR                                                 | Title                                               | Note                                                         |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| [0001](0001-socketio-realtime.md)                   | Socket.IO for real time                             | Replaces the raw `ws` decision                               |
| [0002](0002-postgresql-canonical-store.md)          | PostgreSQL as the source of truth                   |                                                              |
| [0003](0003-transactional-outbox.md)                | Transactional outbox                                |                                                              |
| [0004](0004-inapi-dispatcher-redpanda-deferred.md)  | Dispatcher inside the API; Redpanda deferred        | Replaces the Redpanda ADR                                    |
| [0005](0005-redis-ephemeral-only.md)                | Redis for ephemeral state only                      |                                                              |
| [0006](0006-pg-boss-not-bullmq.md)                  | pg-boss instead of BullMQ                           |                                                              |
| [0007](0007-per-conversation-ordering-row-lock.md)  | Per-conversation ordering with a row-locked counter |                                                              |
| [0008](0008-at-least-once-with-idempotency.md)      | Delivery guarantee: at least once, idempotent       | The agreed contract                                          |
| [0009](0009-modular-monolith.md)                    | Modular monolith                                    |                                                              |
| [0010](0010-clerk-login.md)                         | Clerk for login                                     | Replaces the custom auth ADR                                 |
| [0011](0011-e2e-encryption-deferred.md)             | End-to-end encryption deferred                      | Replaces the Signal ADR; has a "how I would add it" section |
| [0012](0012-minio-s3-not-cloudinary.md)             | S3-compatible media (MinIO locally)                 |                                                              |
| [0013](0013-tanstack-query-zustand.md)              | TanStack Query plus Zustand                         |                                                              |
| [0014](0014-ai-provider-fallback-chain.md)          | AI provider fallback chain, and the @flick bot      |                                                              |
| [0015](0015-fastify.md)                             | Fastify for the HTTP API                            |                                                              |
| [0016](0016-ai-quota-and-privacy-guard.md)          | AI daily quota and per-chat privacy guard           | Redis counter, fail open; switch enforced on every AI path   |
| [0017](0017-multimodal-provider-routing.md)         | Multimodal provider routing                         | Providers that cannot read images or PDFs are skipped        |
| [0018](0018-any-file-type-1gb-presigned-uploads.md) | Any file type, 1 GB, presigned uploads, safe serving | Refines 0012; inline for images, audio, video; PDF by preview link |
| [0019](0019-albums-as-linked-messages.md)           | Albums as linked messages                           | N ordinary messages tied by `album` metadata; 20 items, 2 GiB  |
| [0020](0020-clerk-own-sign-in-paths-and-flick-only-profile.md) | Clerk sign-in paths inside Flick; Flick-only profile | Refines 0010                                         |
| [0021](0021-markdown-rendering-everywhere.md)       | One safe Markdown renderer everywhere               | No raw HTML, safe links                                      |
| [0022](0022-ui-redesign-and-serif-default.md)       | Solid-surface redesign, serif default               | Tokens, contrast tests, hover only with a pointer            |
| [0023](0023-heuristics-first-ai-optional.md)        | Heuristics first, AI optional, only on request      | Safety, mood, scam checks run locally                        |
| [0024](0024-phone-back-navigation-and-gestures.md)  | Phone Back navigation and gestures                  | Back stack with `pushState`, edge swipe, double Back to exit |
| [0025](0025-videos-are-not-transcribed.md)          | Videos are not transcribed                          | Audio and voice notes only; Whisper limit is 25 MB           |
| [0026](0026-global-and-per-chat-wallpaper-precedence.md) | Global and per-chat wallpaper precedence       | Per-chat, then global, then default; pictures stay on device |

# Architecture Decision Records

Each ADR is short: context, decision, alternatives, trade-offs, consequences.

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

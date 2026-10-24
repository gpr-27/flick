# ADR-0005: Redis for ephemeral state only

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0001, ADR-0002

## Context

Some state is short-lived and read often, or has to be shared between API servers. Postgres is the wrong place for it.

## Decision

Redis has a narrow role and **never holds anything we cannot lose**:

- the **Socket.IO Redis adapter**, so rooms work across several API servers;
- **presence** keys with a TTL, refreshed by heartbeats;
- shared **rate limits**;
- **small caches** (for example AI provider cooldowns and link-preview results).

## Alternatives

- **Everything in Postgres.** Presence and rate limits would create a lot of write churn.
- **Redis as a queue or message store.** It would make Redis durable state. Rejected.
- **In-memory only.** Fine for one server, wrong with two.

## Trade-offs

If Redis is down: cross-server live delivery pauses, presence is not updated, the auth cache is skipped, and the
HTTP rate limiter lets requests through. **No message is lost.** Messages are in Postgres and clients recover through sync.

## Consequences

- No Redis persistence settings to tune.
- Not yet tested: that a message sent while Redis is down is still stored and recovered. The code is written for it (Redis calls fail open), and the load-test plan includes a Redis-down run. This line becomes a test reference once that run passes.

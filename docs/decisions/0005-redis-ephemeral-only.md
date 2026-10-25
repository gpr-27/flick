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
HTTP rate limiter lets requests through (each request first waits up to one second for Redis, the client's
`commandTimeout`). **No message is lost.** Messages are in Postgres and clients recover through sync.

## Consequences

- No Redis persistence settings to tune.
- Tested: [`apps/api/test/integration/failure-injection.int.test.ts`](../../apps/api/test/integration/failure-injection.int.test.ts)
  part (a) stops a real Redis container while the API runs. Sends over REST and Socket.IO keep committing with dense
  seqs, reads and sync keep working, and after Redis returns new messages are delivered live again and sync supplies
  what was missed. The test found two faults in the "Redis calls fail open" code, both fixed: the Socket.IO adapter's
  unawaited `publish()` became an unhandled rejection that would have ended the API process on the first broadcast, and
  every request took about 10 s while Redis did not answer. Details and numbers are in
  [`../testing.md`](../testing.md#failure-injection). Not tested: a dispatcher row that fails 20 times (a Redis outage
  of more than about a minute) is dropped and left to sync, as described in the architecture overview.

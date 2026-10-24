# ADR-0006: pg-boss for background jobs (not BullMQ)

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0002, ADR-0005

## Context

Some work should happen later or off the request path: Web Push for offline users, deleting expired
(disappearing) messages, and cleaning abandoned uploads and old outbox rows.

## Decision

Use **pg-boss**. It stores jobs in Postgres. A separate **worker process** (`apps/worker`) runs jobs only. It does not
deliver live messages.

## Alternatives

- **BullMQ.** Mature and fast, but it needs durable Redis. That breaks the rule that Redis holds nothing we cannot
  lose (ADR-0005).
- **Cron plus SQL.** Fine for sweeps, but no retries and no delayed one-off jobs.
- **Kafka delay topics.** Awkward for per-job delays, and Kafka is deferred (ADR-0004).

## Trade-offs

- Job throughput is lower than a Redis queue. These jobs are light.
- Job tables live in the main database.

## Consequences

- Jobs can be scheduled in the same transaction as the data they refer to, when needed.
- One less durable system to back up.

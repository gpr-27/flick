# ADR-0002: PostgreSQL as the source of truth

- **Status:** Accepted (2026-10-24)
- **Related:** [`../architecture/database-schema.md`](../architecture/database-schema.md), ADR-0003, ADR-0007

## Context

The delivery rules need one transaction that covers an idempotency key, a
sequence number, the message and an outbox row. Membership checks need joins against live data.

## Decision

PostgreSQL 17 is the only durable store for chat data. Schema changes are migrations in `packages/database/`. Queries go
through typed helpers. Search uses Postgres full-text search. There is no second store, so no dual write.

## Alternatives

- **Keep MongoDB.** Multi-document transactions exist, but unique constraints, row locks and joins are more natural
  in Postgres. We also want the outbox in the same transaction.
- **A separate search engine (Elasticsearch).** More to run. Postgres full-text search is enough at this scale.
- **Sharding now.** Not needed. See the sharding note.

## Trade-offs

- A single primary is the write limit. The sharding note shows how conversation-based partitioning would lift it.
- Migrations need care. Each one is small.

## Consequences

- The delivery contract is a local ACID transaction, which is easy to test and explain.
- Each table is owned by one module.

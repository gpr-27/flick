# ADR-0004: Dispatcher inside the API; Redpanda/Kafka deferred

- **Status:** Accepted (2026-10-24).
- **Related:** ADR-0001, ADR-0003, ADR-0005, ADR-0006

## Context

One option is to put Redpanda between the outbox and the gateways, with an outbox publisher, topics, consumers, a
`processed_events` table and dead-letter topics. That is a lot of moving parts. With one consumer of the events
(the Socket.IO gateway) they buy nothing yet.

## Decision

A small **dispatcher runs inside the API process**.

1. Claim a batch of unsent outbox rows with `FOR UPDATE SKIP LOCKED`, so several API servers never take the same row.
2. Read current members (membership is read at delivery time, so a removed member gets nothing).
3. Emit to the Socket.IO rooms.
4. Mark the row done after a successful attempt. On failure, record the attempt and retry with backoff.

Duplicates are safe. Clients drop an event whose `seq` they already hold.

**Redpanda/Kafka is deferred.** The rule is: _add it only when a need is shown._ Triggers:

- a second, independent consumer of message events (search indexing, analytics, a notification service);
- a need to replay history into a new system;
- measured dispatcher throughput that one Postgres outbox cannot meet.

The outbox stays the same when that day comes. Only the "emit to rooms" step becomes "publish to a topic".

## Alternatives

- **Redpanda from day one.** Right at large scale, wrong for a first release. More to operate, more to defend.
- **pg-boss for live delivery.** Jobs are for work that can wait. Live events want low latency.
- **Emit directly after commit.** Loses events on a crash (ADR-0003).

## Trade-offs

- The dispatcher shares CPU with the API. It could move to its own process later with no protocol change.
- There is no replay log. Recovery after a long outage is the sync call, which reads the database.

## Consequences

- Fewer containers, no topics, no consumer groups to explain.
- Tests can run the dispatcher against a real Postgres and a Socket.IO server.

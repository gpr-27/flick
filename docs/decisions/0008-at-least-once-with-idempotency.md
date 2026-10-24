# ADR-0008: Delivery guarantee: at least once, with idempotency

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0003, ADR-0004, ADR-0007, [`../architecture/delivery-guarantees.md`](../architecture/delivery-guarantees.md)

## Context

A sender cannot tell "not delivered" from "delivered, ack lost". Any honest design has to retry.

## Decision

This is the agreed contract. The whole project is tested against it.

1. The client gives every message a stable `client_message_id` and reuses it on retry.
2. Every read and write checks conversation membership.
3. One transaction does: idempotency check, sequence allocation, message insert, outbox insert.
4. The sender is acked **only after commit**.
5. The dispatcher sends with retry. Clients drop duplicates by `seq`.
6. **Delivered** is separate from **read**.
7. After a reconnect the client runs **sync** to fetch everything it missed.
8. Membership changes take effect immediately. A removed member receives nothing from then on.

We do **not** claim exactly-once. We claim: stored once, delivered at least once, shown once.

## Alternatives

- **Exactly-once through broker transactions.** Covers only part of the path, not the network to the browser.
- **At most once.** Loses messages.

## Trade-offs

Every receiver must handle duplicates. That is a few lines on the client and it is tested.

## Consequences

- The stage A gate in the implementation plan is the acceptance test for this ADR.

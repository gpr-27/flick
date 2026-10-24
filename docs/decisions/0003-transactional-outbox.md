# ADR-0003: Transactional outbox

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0004, ADR-0008

## Context

After a message is saved we must tell live recipients. If we save, then emit in a separate step, a crash between the
two loses the live event. If we emit first, we can announce a message that was never saved.

## Decision

In the same transaction that inserts the message, insert an **outbox row** describing the event. A dispatcher reads
unsent rows later (ADR-0004). The row is the promise: if the message exists, the event will be sent at least once.

## Alternatives

- **Dual write (save, then emit).** Loses events on a crash. Rejected.
- **Emit from the request handler only.** Same problem, and a slow socket slows the request.
- **Postgres LISTEN/NOTIFY alone.** Notifications are lost if nobody is listening. It can wake the dispatcher, but it
  cannot be the record.
- **Change data capture (Debezium).** Powerful, but heavy to run at this scale.

## Trade-offs

- A small delay between commit and live delivery (the poll interval, 200 ms).
- The outbox table grows. A cleanup job removes old sent rows.
- Delivery is at least once, so receivers must tolerate duplicates (ADR-0008).

## Consequences

- A restart after commit but before live delivery loses nothing. This is part of the stage A gate.

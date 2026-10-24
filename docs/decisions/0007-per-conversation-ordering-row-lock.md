# ADR-0007: Per-conversation ordering with a row-locked counter

- **Status:** Accepted (2026-10-24)
- **Related:** [`../architecture/delivery-guarantees.md`](../architecture/delivery-guarantees.md), ADR-0003

## Context

Every device must agree on the order of messages in a conversation. The order must survive concurrent senders,
retries and restarts. Clients need to detect a gap.

## Decision

`conversations.last_seq` is a counter. The send transaction:

1. `UPDATE conversations SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq` (this locks that one row);
2. inserts the message with `ON CONFLICT (sender_device_id, client_message_id) DO NOTHING`;
3. on a conflict, rolls back (no gap) and returns the existing message;
4. otherwise inserts the outbox row and commits. Only then does it ack the sender.

`(conversation_id, seq)` is unique. Clients apply messages in `seq` order and notice gaps.

## Alternatives

- **A Postgres sequence.** Not transactional: rolled-back values leave gaps, and values can become visible out of order.
- **Client timestamps.** Clocks drift and ties happen. No gap detection.
- **`max(seq) + 1`.** Races without a lock.
- **Broker offsets.** There is no broker (ADR-0004), and offsets would not be dense per conversation anyway.

## Trade-offs

Sends to the **same** conversation take turns. Different conversations never wait on each other. Throughput for one
hot conversation is limited by how long the lock is held. We will measure it, not guess.

## Consequences

- Keep the transaction short. No network calls inside it.
- A test sends many messages to one conversation at once and checks that the seqs are unique and ordered.

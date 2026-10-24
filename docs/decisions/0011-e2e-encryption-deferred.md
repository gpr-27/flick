# ADR-0011: End-to-end encryption is deferred

- **Status:** Accepted (2026-10-24). Replaces the earlier plan for Signal and Sender Keys.

## Context

E2E is a product of its own: key servers, device keys, key changes, backup and recovery. It also breaks server-side
search, link previews, AI features and media checks. A half-built version would be worse than none.

## Decision

Messages are plaintext on the server, protected by TLS plus authorisation. Postgres full-text search and the AI
assistant rely on that. E2E is a **separate security milestone** that starts with a written threat model.

The rule is the same as for Kafka: _add it only when a need is shown._

## How I would add it

1. **Threat model first.** Who is the attacker (server operator, database leak, network)? What metadata stays visible?
2. **Per-device keys.** Each device makes an identity key and one-time prekeys. A key server stores public keys only.
3. **1:1 chats:** use an existing, audited implementation of the Signal protocol. Never write the crypto.
4. **Groups:** sender keys, rekeyed when membership changes, so removed members cannot read new messages.
5. **Server changes:** store ciphertext. The message table keeps `seq`, sender and size, not text. Search moves to the
   client. Link previews and AI run on the client, or only on text the user chooses to share.
6. **Media:** encrypt the file on the client and send the key inside the message.
7. **Recovery:** decide on key backup, or accept that a lost device loses history.

## Alternatives

- **Build it now.** Large, risky, and not needed to prove delivery.
- **Fake it (a lock icon).** Dishonest. Rejected.

## Trade-offs

A database leak exposes message text. This is stated in the known limitations.

## Consequences

- No envelope tables, no key server, no linked devices in the schema.
- A device is just a login session, used for per-device delivery cursors and presence.

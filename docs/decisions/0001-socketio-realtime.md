# ADR-0001: Socket.IO for real time (not raw `ws`)

- **Status:** Accepted (2026-10-24). Replaces the earlier decision to use raw `ws`.
- **Related:** ADR-0005, ADR-0015, [`../architecture/delivery-guarantees.md`](../architecture/delivery-guarantees.md)

## Context

Flick needs live message delivery, typing, presence and call signalling. Browsers drop connections all the time,
so reconnect, heartbeats and fan-out to groups of sockets are needed from day one.

## Decision

Use **Socket.IO** on top of the Fastify HTTP server.

- Reconnect with backoff, heartbeats and acknowledgement callbacks come from the library. We do not rebuild them.
- Each user has a **room** (`user:<id>`) and each device one (`device:<id>`). The dispatcher reads the current
  members of a conversation from Postgres and emits to their user rooms.
- The **Redis adapter** lets several API servers share rooms (ADR-0005).
- Socket.IO delivers live events only. **The database is the truth.** After every reconnect the client runs the
  sync call (see delivery guarantees). A lost event is never a lost message.

## Alternatives

- **Raw `ws`:** smaller and faster, but we would write reconnect, heartbeats, rooms, acks and a multi-server
  adapter ourselves. That is a lot of code to defend for no product gain.
- **Server-Sent Events plus REST:** one-way only. Typing and call signals would need a second channel.
- **A managed service (Pusher, Ably):** another vendor, another bill, less to learn.

## Trade-offs

- Socket.IO has its own protocol. A plain WebSocket client cannot talk to it.
- Rooms and acks hide some detail. We still design for lost events, so the hiding costs us nothing.

## Consequences

- The gateway code is small: authenticate the handshake, join rooms, handle a few events.
- Tests use `socket.io-client`.

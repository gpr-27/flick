# ADR-0013: TanStack Query plus Zustand on the client

- **Status:** Accepted (2026-10-24)

## Context

The React client has two kinds of state: **server state** (conversation lists, history pages, profiles) and **client
state** (connection status, the outbox of unsent messages, the selected chat, UI choices).

## Decision

- **TanStack Query** for server state. History pages use keyset cursors. Socket.IO events update the cache directly.
- **Zustand** for client state, in small stores (connection, outbox, UI). They work outside React, so the sync logic
  is testable.
- **`@tanstack/react-virtual`** for long histories.
- Unsent messages keep their `client_message_id` and are resent after a reconnect.

## Alternatives

- **Redux Toolkit:** more boilerplate for the same split.
- **Context only:** re-renders too much on typing and presence.

## Trade-offs

Two libraries, so the border between them must be respected.

## Consequences

- Optimistic messages reconcile into the cache by `client_message_id` once the server acks.

# Flick real-time protocol

Real-time traffic uses **Socket.IO**. Socket.IO already gives us reconnects, heartbeats, rooms and
acknowledgements, so the protocol is only a list of event names and payloads. The payload schemas
are in `packages/contracts/src/ws/events.ts`; the typed event map is in `ws/frames.ts`
(`ClientToServerEvents`, `ServerToClientEvents`). The server validates every client payload with
these schemas, and the examples below are checked against them by a test.

## Connecting

The Clerk session token goes in the handshake `auth` object, never in the URL.

```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@chat/contracts';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
  auth: { token: await clerk.session.getToken(), deviceId },
  transports: ['websocket'], // see below
});
```

Clients use the WebSocket transport only. The API runs as several replicas without sticky sessions,
and Socket.IO's HTTP long-polling fallback needs every request of a session to reach the same
replica.

A bad token fails the connection with `connect_error: unauthorized`. After a reconnect the client
runs `sync_request` (see below). On connect the server puts the socket in the rooms `user:<userId>`
and `device:<deviceId>`.

## Requests and answers

Request/response events use an acknowledgement callback. Every callback gets
`{ ok: true, data }` or `{ ok: false, error }`, where `error` is `{ code, message, retryable }`.

| Event                | Answer (`data`)                                      |
| -------------------- | ---------------------------------------------------- |
| `send_message`       | `MessageAccepted` (`message_id`, `seq`, `duplicate`) |
| `sync_request`       | a page of events: `events`, `next_cursor`            |
| `presence_subscribe` | the current status of each allowed user              |
| `delivery_ack`       | `null`                                               |
| `read_ack`           | `null`                                               |

A failed `send_message` answers `ok: false` with an error `code` such as `NOT_A_MEMBER`. If `retryable` is true, send again with the **same** `client_message_id`; the server
keeps one message per `(device, client_message_id)`, so a retry never creates a second message.

```json client send_message
{
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "client_message_id": "client_msg_456",
  "content": { "type": "text", "text": "Hello" }
}
```

The ack of that call (`message_accepted`):

```json
{
  "ok": true,
  "data": {
    "client_message_id": "client_msg_456",
    "message_id": "0192f5a0-0000-7000-8000-00000000001e",
    "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
    "seq": 42,
    "created_at": "2026-10-24T12:00:00.000Z",
    "duplicate": false
  }
}
```

The ack is sent only after the database transaction has committed, so "accepted" means "stored".

## Events from the server

Messages arrive as events. The client keeps the highest `seq` it has per conversation and ignores
a `seq` it already has.

```json server new_message
{
  "message": {
    "message_id": "0192f5a0-0000-7000-8000-00000000001e",
    "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
    "seq": 42,
    "sender_user_id": "0192f5a0-0000-7000-8000-000000000001",
    "client_message_id": null,
    "content": { "type": "text", "text": "Hello" },
    "created_at": "2026-10-24T12:00:00.000Z",
    "edited_at": null,
    "deleted_at": null,
    "expires_at": null,
    "reactions": [],
    "starred": false,
    "viewed": false
  }
}
```

`message_edited`, `message_deleted`, `reaction_added` and `reaction_removed` each take the next
`seq` of the conversation too, so gap detection covers them and sync replays them.

```json server reaction_added
{
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "seq": 43,
  "message_id": "0192f5a0-0000-7000-8000-00000000001e",
  "user_id": "0192f5a0-0000-7000-8000-000000000002",
  "emoji": "👍"
}
```

Other server events: `receipt_update` (delivered or read cursor of a member),
`conversation_updated` (the conversation changed; `conversation` is `null` if you lost access),
`pins_changed` (a message was pinned or unpinned; it takes no seq, so sync does not replay it),
`user_updated` (someone you share a chat with changed their name, username or picture; no seq, and never sent to people who blocked them or are blocked by them),
`presence_update`, `typing_start` / `typing_stop` / `activity` (with `user_id`, ephemeral),
and the 1:1 call events below.

```json server receipt_update
{
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "user_id": "0192f5a0-0000-7000-8000-000000000002",
  "delivered_seq": 42,
  "read_seq": 41
}
```

## Receipts

After storing messages, the device sends `delivery_ack` ("I have everything up to this seq"). When
the user has seen them, the client sends `read_ack`. Both only move forward on the server. The
sender gets `receipt_update` events and shows the ticks.

```json client delivery_ack
{ "acks": [{ "conversation_id": "0192f5a0-0000-7000-8000-000000000014", "seq": 42 }] }
```

```json client read_ack
{ "conversation_id": "0192f5a0-0000-7000-8000-000000000014", "seq": 42 }
```

## Sync: why nothing is lost

Live events are best effort. Postgres is the truth, and sync reads from it.

1. Every change in a conversation takes the next number `seq` (1, 2, 3, ...), allocated while the
   conversation row is locked, so seqs commit in order.
2. The client stores, per conversation, the highest seq it has with **no gap before it**.
3. On connect and on every reconnect it sends those cursors in `sync_request`. The server replies
   with everything after each cursor, in seq order, page by page (`next_cursor`).
4. A live event with a seq above `cursor + 1` means a gap, so the client runs sync for that
   conversation. A seq at or below the cursor is a duplicate and is dropped.

Because seqs commit in order, if a page contains seq N then every seq below N is already visible,
and nothing can appear later behind the cursor. A live event lost, duplicated or reordered is
therefore always repaired by the next sync.

```json client sync_request
{
  "cursors": [{ "conversation_id": "0192f5a0-0000-7000-8000-000000000014", "after_seq": 40 }],
  "limit": 200
}
```

The answer has `events` (`new_message`, `message_edited`, `message_deleted`, `reaction_added`,
`reaction_removed`, each with its payload), `removed_conversation_ids` (conversations you left) and
`next_cursor` (`null` when you are up to date).

## Presence, typing and activity

`presence_subscribe` replaces your watch list. Only users who share a conversation with you are
allowed; the rest are ignored. The ack has the current status, and later changes arrive as
`presence_update`. A user is online while at least one device is connected.

```json client presence_subscribe
{ "user_ids": ["0192f5a0-0000-7000-8000-000000000002"] }
```

```json server presence_update
{
  "user_id": "0192f5a0-0000-7000-8000-000000000002",
  "online": false,
  "last_seen_at": "2026-10-24T12:00:00.000Z"
}
```

`last_seen_at` is `null` when the user hides it, and while they are online.

`typing_start`, `typing_stop` and `activity` (recording or uploading) are never stored. The server
checks that the sender is a member, throttles `start` to one per 3 seconds per conversation, and
sends the event to the other members only. Receivers hide the indicator after 6 seconds.

```json client typing_start
{ "conversation_id": "0192f5a0-0000-7000-8000-000000000014" }
```

```json client activity
{
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "activity": "recording_voice",
  "state": "start"
}
```

## 1:1 calls

Calls are peer to peer (WebRTC). The server only relays signalling: `call_offer`, `call_answer`,
`call_ice`, `call_end`, `call_reject`, `call_busy`, `call_renegotiate`. The client never says who to
send to; after an offer the server relays to the other side of that call only, and adds
`from_user_id`. The server replies `call_unavailable` to the caller if the pair is blocked or the
callee is offline, and `call_busy` if either side is already on another call. If another device
answers, the user's other devices get `call_end` with reason `answered_elsewhere`. If a user drops
for more than 10 seconds, the peer gets `call_end` with reason `failed`.

```json client call_offer
{
  "call_id": "0192f5a0-0000-7000-8000-000000000032",
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "media": "audio",
  "sdp": { "type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" }
}
```

```json server call_offer
{
  "call_id": "0192f5a0-0000-7000-8000-000000000032",
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "media": "audio",
  "sdp": { "type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" },
  "from_user_id": "0192f5a0-0000-7000-8000-000000000001"
}
```

The other call events carry `call_id` and, depending on the event, an `sdp`, a `candidate` or a
`reason`; see `ws/events.ts`. `call_unavailable` has `call_id` and `reason`.

## Limits

One Socket.IO packet is at most 256 KiB (`LIMITS.MAX_FRAME_BYTES`). Each socket has a small
token bucket; over it, the ack is `RATE_LIMITED` (`retryable: true`) and events without an ack are
dropped. Group size, page sizes and ack counts are in `packages/contracts/src/limits.ts`.

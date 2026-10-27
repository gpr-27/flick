# Flick protocol: REST and real time

Flick talks to the API in two ways. **REST** (JSON over HTTPS) is used for everything that is a request and an answer:
profiles, chat lists, history, uploads, settings and all AI features. **Socket.IO** is used for the things that must be
instant: sending a message, live events, receipts, presence, typing and 1:1 call signalling. Both are described by zod
schemas in `packages/contracts`, shared by the API and the web client, so the two sides cannot disagree. This page lists
every REST endpoint (grouped by module, with method, path, purpose and auth) and every Socket.IO event.

Related: [`overview.md`](overview.md), [`delivery-guarantees.md`](delivery-guarantees.md),
[`database-schema.md`](database-schema.md), [`../security/auth.md`](../security/auth.md),
[`../ai/README.md`](../ai/README.md), [`../features/README.md`](../features/README.md).

Real-time traffic uses **Socket.IO**. Socket.IO already gives us reconnects, heartbeats, rooms and
acknowledgements, so the protocol is only a list of event names and payloads. The payload schemas
are in `packages/contracts/src/ws/events.ts`; the typed event map is in `ws/frames.ts`
(`ClientToServerEvents`, `ServerToClientEvents`). The server validates every client payload with
these schemas, and the examples below are checked against them by a test.

## Socket.IO event list

| Direction        | Events                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client to server | `send_message`, `delivery_ack`, `read_ack`, `sync_request`, `typing_start`, `typing_stop`, `activity`, `presence_subscribe`, `call_offer`, `call_answer`, `call_ice`, `call_end`, `call_reject`, `call_busy`, `call_renegotiate`                                                                                                                                                                    |
| Server to client | `new_message`, `message_edited`, `message_deleted`, `reaction_added`, `reaction_removed`, `receipt_update`, `typing_start`, `typing_stop`, `activity`, `presence_update`, `conversation_updated`, `pins_changed`, `notification_created`, `user_updated`, the call events (`call_offer`, `call_answer`, `call_ice`, `call_end`, `call_reject`, `call_busy`, `call_renegotiate`, `call_unavailable`) |

Events that take a `seq` (`new_message`, `message_edited`, `message_deleted`, `reaction_*`) are replayed by sync. The
others (`receipt_update`, `pins_changed`, `notification_created`, `user_updated`, presence, typing, calls) are live only.

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
`notification_created` (a new alert for the notification centre: the bell goes up by one),
`user_updated` (someone you share a chat with changed their name, username or picture; no seq, and never sent to people who blocked them or are blocked by them),
`presence_update`, `typing_start` / `typing_stop` / `activity` (with `user_id`, ephemeral),
and the 1:1 call events below.

```json server notification_created
{
  "id": "0192f5a0-0000-7000-8000-000000000031",
  "kind": "mention",
  "conversation_id": "0192f5a0-0000-7000-8000-000000000014",
  "message_id": "0192f5a0-0000-7000-8000-000000000015",
  "created_at": "2026-01-01T12:00:00.000Z"
}
```

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

## REST API

All REST endpoints are declared once in `packages/contracts/src/rest/endpoints.ts` (the `ENDPOINTS` object, 189
entries). The API registers its routes from that list and the web client builds its typed fetcher from it. A
conformance test (`apps/api/test/routes.test.ts` plus the integration conformance file) fails if an endpoint has no
route or no test scenario, so this list cannot drift from the code.

**Conventions**

- **Auth.** Every endpoint below needs `Authorization: Bearer <Clerk session token>` and `X-Device-Id: <uuid>` unless
  the Auth column says "public". See [`../security/auth.md`](../security/auth.md).
- **Errors** have the shape `{ error: { code, message, retryable } }`. Common codes: `UNAUTHORIZED` (401),
  `NOT_A_MEMBER` / `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (400), `PAYLOAD_TOO_LARGE` (413),
  `RATE_LIMITED` (429), `FEATURE_DISABLED` (501), `AI_UNAVAILABLE` / `SERVICE_UNAVAILABLE` (503), `SLOW_MODE` (429).
- **Lists** use keyset paging: `?limit=` (default 50, max 100) and an opaque `cursor`.
- **Rate limit.** One global per-IP limit (`RATE_LIMIT_MAX`, default 300 per minute) plus per-user limits on AI
  routes and the daily AI quota (see [`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md)).
- **AI routes** (`/ai/*`, `/flick/*`) answer 503 when no provider key is set, 429 when the daily quota is used, and 403
  `AI is turned off for this chat` when the user switched AI off for that chat.

### Users and account

| Method | Path                           | Purpose                                                                                                 |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| GET    | `/users/me`                    | The signed-in profile (creates the local user on first call).                                           |
| PATCH  | `/users/me`                    | Edit display name, username, about, avatar.                                                             |
| GET    | `/users/search`                | Find people by name or username (respects blocks).                                                      |
| GET    | `/users/directory`             | Paged people directory.                                                                                 |
| GET    | `/users/username-available`    | Is this username free?                                                                                  |
| GET    | `/users/by-username/:username` | Profile by username.                                                                                    |
| GET    | `/users/:user_id`              | Profile by id (about and last seen follow privacy settings).                                            |
| GET    | `/users/me/stats`              | Counts for the profile page.                                                                            |
| GET    | `/users/me/settings`           | Account settings (read receipts, AI language, ...).                                                     |
| PATCH  | `/users/me/settings`           | Change account settings.                                                                                |
| GET    | `/users/me/privacy`            | Privacy audiences (last seen, photo, about).                                                            |
| PATCH  | `/users/me/privacy`            | Change privacy audiences.                                                                               |
| GET    | `/users/me/guide`              | In-app tour and tips progress.                                                                          |
| PATCH  | `/users/me/guide`              | Update guide progress.                                                                                  |
| GET    | `/users/me/export`             | Download all of the user's data as a JSON file.                                                         |
| POST   | `/users/me/delete`             | Delete the account (needs the exact username).                                                          |
| DELETE | `/users/me/flick-chat`         | Clear the chat with the Flick assistant.                                                                |
| GET    | `/users/me/login-alerts`       | Is the "new device sign-in" alert on?                                                                   |
| PUT    | `/users/me/login-alerts`       | Turn that alert on or off.                                                                              |
| GET    | `/me/stats`                    | "Your week in Flick" summary.                                                                           |
| GET    | `/platform/email-alias`        | My email-to-chat address (`<username>@INBOUND_EMAIL_DOMAIN`), or `null` when the feature is not set up. |
| GET    | `/devices`                     | List the user's devices.                                                                                |
| DELETE | `/devices/:device_id`          | Sign one device out.                                                                                    |
| POST   | `/devices/revoke-others`       | Sign out every device except this one.                                                                  |
| POST   | `/blocks`                      | Block a user.                                                                                           |
| DELETE | `/blocks/:user_id`             | Unblock.                                                                                                |
| GET    | `/blocks`                      | List blocked users.                                                                                     |
| POST   | `/reports`                     | Report a user or message.                                                                               |

### Conversations, members, invites

| Method | Path                                                        | Purpose                                                          |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/conversations`                                            | Chat list with last message, unread count and own preferences.   |
| GET    | `/conversations/:conversation_id`                           | One conversation.                                                |
| POST   | `/conversations/direct`                                     | Open (or find) a 1:1 chat.                                       |
| POST   | `/conversations/saved`                                      | Open the "Saved messages" chat (a chat with yourself).           |
| POST   | `/conversations/group`                                      | Create a group.                                                  |
| PATCH  | `/conversations/:conversation_id`                           | Edit group name, description, avatar, admin-only switches.       |
| PATCH  | `/conversations/:conversation_id/prefs`                     | Own preferences: pin, archive, mute, favourite, wallpaper, lock. |
| DELETE | `/conversations/:conversation_id`                           | Delete or clear the chat for me only.                            |
| POST   | `/conversations/:conversation_id/leave`                     | Leave a group.                                                   |
| GET    | `/conversations/:conversation_id/members`                   | Members and roles.                                               |
| POST   | `/conversations/:conversation_id/members`                   | Add members.                                                     |
| DELETE | `/conversations/:conversation_id/members/:user_id`          | Remove a member.                                                 |
| PATCH  | `/conversations/:conversation_id/members/:user_id`          | Change a member's role.                                          |
| GET    | `/conversations/:conversation_id/mention-candidates`        | People to suggest for `@`.                                       |
| GET    | `/conversations/:conversation_id/shared`                    | Shared media, files and links.                                   |
| POST   | `/conversations/:conversation_id/invites`                   | Create an invite link (only a hash is stored).                   |
| GET    | `/invites/:code`                                            | Preview a group from an invite code.                             |
| POST   | `/invites/:code/join`                                       | Join (or request to join) through a link.                        |
| DELETE | `/invites/:code`                                            | Revoke an invite link.                                           |
| GET    | `/conversations/:conversation_id/join-requests`             | Pending join requests (admins).                                  |
| POST   | `/conversations/:conversation_id/join-requests/:request_id` | Approve or reject a request.                                     |
| GET    | `/chat-lists`                                               | The user's folders and coloured tags.                            |
| POST   | `/chat-lists`                                               | Create a folder or tag.                                          |
| PATCH  | `/chat-lists/:list_id`                                      | Rename, recolour, change its chats.                              |
| DELETE | `/chat-lists/:list_id`                                      | Delete a folder or tag.                                          |

### Messages

| Method | Path                                                     | Purpose                                                 |
| ------ | -------------------------------------------------------- | ------------------------------------------------------- |
| POST   | `/conversations/:conversation_id/messages`               | Send a message (REST twin of the `send_message` event). |
| GET    | `/conversations/:conversation_id/messages`               | History, newest first, keyset on `before_seq`.          |
| POST   | `/sync`                                                  | Catch-up by cursors (REST twin of `sync_request`).      |
| PATCH  | `/conversations/:conversation_id/messages/:message_id`   | Edit a message.                                         |
| DELETE | `/conversations/:conversation_id/messages/:message_id`   | Delete for everyone (tombstone).                        |
| PUT    | `.../messages/:message_id/reaction`                      | React with an emoji.                                    |
| DELETE | `.../messages/:message_id/reaction`                      | Remove my reaction.                                     |
| PUT    | `.../messages/:message_id/star`                          | Star (private).                                         |
| DELETE | `.../messages/:message_id/star`                          | Unstar.                                                 |
| GET    | `/starred`                                               | All starred messages.                                   |
| POST   | `/conversations/:conversation_id/pins`                   | Pin a message.                                          |
| DELETE | `/conversations/:conversation_id/pins/:message_id`       | Unpin.                                                  |
| GET    | `/conversations/:conversation_id/pins`                   | Pinned messages.                                        |
| POST   | `.../messages/:message_id/open`                          | Open a view-once message (once).                        |
| GET    | `.../messages/:message_id/info`                          | Who got it and who read it.                             |
| GET    | `/conversations/:conversation_id/polls/:message_id`      | Poll results.                                           |
| POST   | `/conversations/:conversation_id/polls/:message_id/vote` | Vote in a poll.                                         |
| GET    | `/search`                                                | Full-text search over messages (and voice transcripts). |
| POST   | `/receipts/delivered`                                    | Delivered cursor (REST twin of `delivery_ack`).         |
| POST   | `/conversations/:conversation_id/read`                   | Read cursor (REST twin of `read_ack`).                  |
| GET    | `/conversations/:conversation_id/notes`                  | My private notes in this chat.                          |
| PUT    | `.../messages/:message_id/note`                          | Set my private note on a message.                       |
| DELETE | `.../messages/:message_id/note`                          | Remove the note.                                        |
| GET    | `.../messages/:message_id/edits`                         | Edit history of a message.                              |
| GET    | `/conversations/:conversation_id/draft`                  | My unsent draft (follows me across devices).            |
| PUT    | `/conversations/:conversation_id/draft`                  | Save the draft.                                         |
| DELETE | `/conversations/:conversation_id/draft`                  | Clear the draft.                                        |
| POST   | `/conversations/:conversation_id/scheduled`              | Schedule a text message.                                |
| GET    | `/scheduled`                                             | My scheduled messages.                                  |
| PATCH  | `/scheduled/:scheduled_id`                               | Change time or text.                                    |
| DELETE | `/scheduled/:scheduled_id`                               | Cancel.                                                 |

### Media, GIFs, link previews

| Method | Path                             | Purpose                                                                                                                                             |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/media/presign`                 | Start an upload: returns a presigned POST (any file type, up to 1 GB).                                                                              |
| POST   | `/media/:attachment_id/complete` | Finish: the server checks size and type against the stored bytes.                                                                                   |
| GET    | `/media/:attachment_id/url`      | A 5-minute signed download link. `?preview=1` returns an inline link, and only for a verified PDF; any other file type gets a normal download link. |
| GET    | `/media/usage`                   | Storage used per chat.                                                                                                                              |
| GET    | `/gifs/search`, `/gifs/trending` | GIPHY proxy (the key never reaches the browser).                                                                                                    |
| GET    | `/link-preview`                  | Safe link preview (blocks private addresses).                                                                                                       |

### Calls

| Method | Path                            | Purpose                                                                      |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/calls/turn`                   | Short-lived TURN credentials (STUN only when TURN is unset).                 |
| POST   | `/calls/livekit-token`          | Token to join a group call room.                                             |
| GET    | `/calls/group/:conversation_id` | Who is in the group call now.                                                |
| POST   | `/calls/group/presence`         | Heartbeat that keeps me listed in a group call.                              |
| POST   | `/calls/links`                  | Create a call link.                                                          |
| GET    | `/calls/links/:code`            | Look up a call link.                                                         |
| DELETE | `/calls/links/:code`            | Revoke a call link.                                                          |
| POST   | `/calls/decline-from-push`      | Decline a call from the notification (public; one-time token from the push). |
| GET    | `/calls`                        | Call log.                                                                    |

### Notifications, push, reminders

| Method | Path                      | Purpose                                          |
| ------ | ------------------------- | ------------------------------------------------ |
| GET    | `/notifications`          | Notification centre (newest first).              |
| GET    | `/notifications/unread`   | Unread count for the bell.                       |
| POST   | `/notifications/read`     | Mark as read.                                    |
| DELETE | `/notifications`          | Clear all.                                       |
| GET    | `/push/vapid-key`         | Public VAPID key for subscribing.                |
| POST   | `/push/subscribe`         | Save a browser push subscription.                |
| POST   | `/push/unsubscribe`       | Remove it.                                       |
| GET    | `/push/status`            | Subscription health (last status, last success). |
| POST   | `/push/test`              | Send myself a test notification.                 |
| POST   | `/reminders`              | Remind me about a message or chat at a time.     |
| GET    | `/reminders`              | My reminders.                                    |
| DELETE | `/reminders/:reminder_id` | Cancel a reminder.                               |

### Groups: tools, webhooks, events

| Method | Path                                                   | Purpose                                               |
| ------ | ------------------------------------------------------ | ----------------------------------------------------- |
| GET    | `/conversations/:conversation_id/group-tools`          | Slow mode and welcome text settings.                  |
| PATCH  | `/conversations/:conversation_id/group-tools`          | Change them (admins).                                 |
| GET    | `/conversations/:conversation_id/flagged`              | Recent messages flagged by local rules (admins only). |
| GET    | `/conversations/:conversation_id/analytics`            | Group activity numbers.                               |
| GET    | `.../messages/:message_id/card`                        | State of a checklist, expense, game or event card.    |
| POST   | `.../messages/:message_id/card/act`                    | Act on a card (tick an item, settle, play a move).    |
| POST   | `/conversations/:conversation_id/group-ai`             | AI helpers for a group (on request).                  |
| POST   | `/ai/link-check`                                       | Ask AI whether a link looks risky (on request).       |
| GET    | `/conversations/:conversation_id/webhooks`             | List incoming webhooks.                               |
| POST   | `/conversations/:conversation_id/webhooks`             | Create one (token shown once, stored as a hash).      |
| DELETE | `/conversations/:conversation_id/webhooks/:webhook_id` | Revoke.                                               |
| POST   | `/events`, GET `/events`                               | Create a shared Event card; list events (calendar).   |
| PUT    | `/events/:message_id/rsvp`, GET same                   | Answer going / maybe / no; list answers.              |

### Personal productivity

| Method | Path                                    | Purpose                                                   |
| ------ | --------------------------------------- | --------------------------------------------------------- |
| GET    | `/productivity/settings`, PUT same      | Digest, quiet hours, priority contacts.                   |
| GET    | `/productivity/digest`                  | Today's digest of what needs attention.                   |
| GET    | `/productivity/nudges`                  | Promises and follow-ups worth a nudge (local heuristics). |
| GET    | `/productivity/tags`                    | My tags on saved messages.                                |
| POST   | `/productivity/tag-saved`               | Tag a saved message (note, link, task, idea, receipt).    |
| POST   | `/productivity/ask-saved`               | Ask a question over Saved messages (AI).                  |
| POST   | `/productivity/extract-reminder`        | Pull a reminder time out of a message (AI).               |
| POST   | `/productivity/meeting-notes`           | Turn a chat into meeting notes (AI).                      |
| GET    | `/bookmarks/collections`, POST same     | List or create bookmark collections.                      |
| DELETE | `/bookmarks/collections/:collection_id` | Delete a collection.                                      |
| GET    | `/bookmarks`, POST same                 | List or add bookmarks.                                    |
| DELETE | `/bookmarks/:collection_id/:message_id` | Remove a bookmark.                                        |

### AI (all on request; see [`../ai/README.md`](../ai/README.md))

| Method       | Path                                                          | Purpose                                                                                                                                                                |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET          | `/ai/status`                                                  | Is AI configured? Which providers are up?                                                                                                                              |
| GET          | `/ai/usage`                                                   | Today's usage against the daily limit, by feature.                                                                                                                     |
| POST         | `/ai/summarize`                                               | Summarise unread messages.                                                                                                                                             |
| POST         | `/ai/suggest-replies`                                         | Three reply suggestions.                                                                                                                                               |
| POST         | `/ai/compose`                                                 | Write or rewrite text ("Write this with Flick").                                                                                                                       |
| POST         | `/ai/translate`, `/ai/translate-batch`                        | Translate one text or many messages. Both take an optional `conversation_id`, so the chat's privacy switch is checked and the translation cache is scoped to the chat. |
| POST         | `/ai/transcribe`                                              | Transcribe a voice note.                                                                                                                                               |
| GET/PUT      | `/ai/transcript/:attachment_id`                               | Read or edit a stored transcript.                                                                                                                                      |
| GET/PUT      | `/ai/auto-translate/:conversation_id`                         | Per-chat auto-translate language.                                                                                                                                      |
| GET/PUT      | `/ai/transcribe-prefs/:conversation_id`                       | Per-chat auto-transcribe switch.                                                                                                                                       |
| GET/PATCH    | `/ai/translation-settings`                                    | Global auto-transcribe and the "don't translate" word list.                                                                                                            |
| POST         | `/ai/analyze`                                                 | Explain or analyse a message, image, file or voice note.                                                                                                               |
| POST         | `/ai/chat`                                                    | Chat with Flick (streams Server-Sent Events).                                                                                                                          |
| POST         | `/ai/understand`                                              | Conversation understanding (tone, intent, "why did Flick say this").                                                                                                   |
| GET/PUT      | `/ai/privacy/:conversation_id`                                | "Allow Flick to read this chat" switch.                                                                                                                                |
| GET/PUT      | `/ai/preference`                                              | Speed preference (fast or quality).                                                                                                                                    |
| GET/DELETE   | `/ai/data`                                                    | Export or erase my stored AI data (Flick memories, topics and ratings, writing style, chat styles, transcripts I caused, translation and transcription settings).      |
| GET/POST     | `/ai/style-profile`                                           | Read or rebuild "how I write".                                                                                                                                         |
| GET/PUT      | `/ai/chat-style/:conversation_id`                             | Writing style for one chat.                                                                                                                                            |
| GET/PUT      | `/ai/persona`                                                 | My Flick persona.                                                                                                                                                      |
| POST         | `/ai/actions`, `/ai/plan`, `/ai/poll-draft`, `/ai/flashcards` | Action items, a plan, a poll draft, flashcards from a chat.                                                                                                            |
| POST         | `/ai/dictate`                                                 | Speech to text for the composer (audio up to ~12 MB body).                                                                                                             |
| GET/POST     | `/flick/memories`                                             | What Flick remembers about me; add one.                                                                                                                                |
| PATCH/DELETE | `/flick/memories/:id`, DELETE `/flick/memories`               | Edit, delete one, or clear all.                                                                                                                                        |
| GET/POST     | `/flick/topics`                                               | Topics (fresh contexts) in the Flick chat.                                                                                                                             |
| PATCH        | `/flick/topics/:id`                                           | Rename a topic.                                                                                                                                                        |
| POST         | `/flick/topics/:id/resume`                                    | Start a new topic that continues a finished one (Flick can read the earlier topic again; stored in `ai_topics.resumes_topic_id`).                                      |
| POST         | `/flick/feedback`, `/flick/followups`                         | Thumbs up/down on an answer; follow-up suggestions.                                                                                                                    |

### Routes outside the contract list

These are not in `ENDPOINTS` because they are not called by the web client with a user session.

| Method | Path                | Auth               | Purpose                                                                                                     |
| ------ | ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/health/live`      | public             | Process is up.                                                                                              |
| GET    | `/health/ready`     | public             | Postgres and Redis answer.                                                                                  |
| GET    | `/metrics`          | public (restrict)  | Prometheus metrics. Do not expose it on the internet.                                                       |
| POST   | `/hooks/:id/:token` | token in the URL   | Incoming webhook: `{"text": "..."}` posts as the Flick bot. 30 per minute per IP. Token compared as a hash. |
| POST   | `/inbound/email`    | `x-inbound-secret` | Email-to-chat: mail to `<username>@INBOUND_EMAIL_DOMAIN` lands in that user's Saved messages. 404 if unset. |

## Limits

One Socket.IO packet is at most 1 MiB (`LIMITS.MAX_FRAME_BYTES`; a 65,000-character text message is at most about 260 KB). Each socket has a small
token bucket; over it, the ack is `RATE_LIMITED` (`retryable: true`) and events without an ack are
dropped. Group size, page sizes and ack counts are in `packages/contracts/src/limits.ts`.

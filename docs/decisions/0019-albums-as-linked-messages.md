# ADR-0019: Albums are linked messages, not a new message type

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0007, ADR-0008, ADR-0018

## Context

Choosing several photos and videos should look like one album in the chat, as in other messengers. The delivery
pipeline, receipts, reactions, replies, search and deletion all work on one message at a time. A new "album" message
that holds many attachments would need new rules for each of them (partial failure, per-item delete, per-item reply).

## Decision

An album is **N ordinary messages** (type `image` or `video`), one per file, each with its own attachment, seq,
`client_message_id` and receipts. They are tied together only by a small `album` object in the message content:
`{ id, index, count, videos? }` (`AlbumMeta` in `packages/contracts/src/content.ts`). The web client groups messages
with the same `album.id` that sit next to each other into one grid. Albums have landed with these exact limits (`MAX_ALBUM_*` in
`limits.ts`): 20 items, 2 GiB in total for one send, each file up to 1 GB, and 3 uploads in flight at a time. The caption
(and the reply target) goes on the first item only. `videos` counts how many of the items are videos, so the chat list
and notifications can say "3 photos and 2 videos" without reading the other messages. Photos and videos form the album;
files sent with "Send as files" go as separate messages and are not grouped.

- No database change: the album data lives in `messages.content` (jsonb).
- Items are sent in order; each is idempotent on its own, so a retry never duplicates an item.
- If one file fails, the others still arrive and the failed item can be retried or discarded.
- Replying to, reacting to, starring, deleting or forwarding works on one item, as for any message.
- A message with `index >= count` or `videos > count` is rejected by validation.

## Alternatives

- **One message with an attachment list.** One ack for all files, but one failed upload blocks the album, and every
  per-message feature needs an "which item?" parameter.
- **A separate albums table.** More joins and migrations for no extra guarantee.

## Trade-offs

Other clients (or an old client) show an album as separate images, which is acceptable. The grid is built on the client
from message order, so if another message lands between two items the group splits (rare; items of one album are sent
back to back). Chat-list previews say "N photos" from the content, not from a join.

## Consequences

- Delivery guarantees are unchanged and apply to every item.
- Docs: [`../features/rich-messages.md`](../features/rich-messages.md), [`../features/media-and-files.md`](../features/media-and-files.md).

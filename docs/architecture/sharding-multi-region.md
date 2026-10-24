# Sharding and multi-region (future design)

**Status: deferred. Nothing here is built.** It is a design note for the day one Postgres primary is not enough
or users are spread across regions. Rule: add it only when a need is shown. Compare with the
[capacity exercise](system-design.md#6-capacity-estimate-a-hypothetical-exercise), which is hypothetical.

## 1. Shard by conversation

Every message belongs to one conversation, and one conversation has one counter (`last_seq`). So the natural shard
key is `conversation_id`.

- The send transaction (counter, message, outbox) touches one conversation, so it stays on **one shard**.
- A conversation never changes shard, so its `seq` order is never split.
- Routing: hash `conversation_id` into many virtual buckets (for example 1,024), then map buckets to shards. Moving a
  bucket moves data without rehashing everything.

User data (profiles, settings, the list of a user's conversations) is small and lives in a separate directory
database, or is replicated to every shard.

## 2. What gets harder

| Topic                        | Problem                                  | Approach                                                                               |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Conversation list for a user | Conversations sit on many shards         | Keep a per-user index of conversation ids and last-message summary                     |
| Search across chats          | One query must visit many shards         | Query each shard and merge, or search within one chat only                             |
| Hot conversation             | One row lock caps its throughput         | Measure first. For huge groups, send a light "new post" hint and let clients fetch     |
| Resharding                   | Moving a bucket while sends continue     | Copy, then switch the bucket map in one step, with a short write pause for that bucket |
| Cross-shard transactions     | Creating a direct chat touches two users | Create the conversation on its shard; update each user index afterwards, with retry    |

Ordering stays **per conversation**. A global order across the platform is not needed and would be costly.

## 3. Multi-region

Give each conversation a **home region** where its counter lives.

- A send goes to the home region. A user far from it pays one cross-region round trip.
- Other regions get the event by replication and emit to their own Socket.IO rooms.
- If a home region fails, another takes over with a **fencing epoch**, so the old region cannot allocate a `seq` after
  the switch. Messages not yet replicated are a known risk and must be stated plainly.
- Presence is eventually consistent across regions.
- Data residency rules can pick the home region for a conversation.

This is where a broker such as Redpanda becomes useful: it carries events between regions and allows replay. That is
one of the triggers in [ADR-0004](../decisions/0004-inapi-dispatcher-redpanda-deferred.md).

## 4. Summary

| Idea                           | State                    |
| ------------------------------ | ------------------------ |
| One region, one primary        | The current design       |
| Shard by conversation          | Designed here, not built |
| Home region per conversation   | Designed here, not built |
| Broker for cross-region events | Deferred (ADR-0004)      |

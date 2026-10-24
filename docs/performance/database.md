# Flick database performance

Real PostgreSQL 17 with 1 million messages, measured on a laptop. Every number below comes from a run
made on **2026-10-24** (UTC) on the machine described under "Environment". Nothing is estimated unless the
text says "estimate". Raw results are in [`scripts/bench/db/results/`](../../scripts/bench/db/results/) and the query plans in
[`query-plans/`](query-plans/).

## Summary

1. **One very busy conversation tops out at about 450 to 560 messages per second** (measured: 453, 559 and
   471 sends/s at 1, 8 and 32 concurrent senders). More senders do not help: they queue on the
   `conversations.last_seq` row lock. The lock is held for about 2 ms, which is the whole send
   transaction (BEGIN, four statements, COMMIT). Turning off the disk flush (`synchronous_commit = off`) raised
   it only to about 470 to 640 per second, so the limit is the number of round trips made while the lock is
   held, not the disk.
2. **Different conversations do not wait for each other.** Sends to distinct conversations reached 364 (1 sender),
   898 (8) and 1,372 (32) per second in the main run. A second sample of the same setup, run later, gave
   398, 1,760 and 2,172, so expect about +/-2x noise on this laptop (see Limitations).
3. **Reads are fast.** Latest 50 messages: 0.74 ms average at one client. Deep keyset page: 0.63 ms.
   Membership check: 0.47 ms. Chat list for 23 chats: 1.0 ms; for 1,000 chats: 3.4 ms. Receipts for a
   600-member group: 1.6 ms. Cursor updates: 0.5 to 0.6 ms. All use an index; the plans show no
   problem-size sequential scan and no sort larger than a few thousand rows.
4. **One real problem was found and fixed: searching for a common word was slow (about 100 ms, only 10 searches
   per second).** Migration `0010_perf` swaps the search index for one that also contains `conversation_id`.
   Measured before and after on the same data: **102 ms to 3.3 ms** (23 chats), **8.3 ms to 1.0 ms** (inside one
   chat). The cost: the index is 13% bigger and an insert into `messages` takes about 0.05 ms longer
   (0.254 to 0.301 ms on the server).
5. **Still slow, not fixed:** a common-word search for a user who is in 1,000 chats (75 ms after the change, 133 ms
   before). That is far more chats than the seed's busiest real user (23). See "What is not fixed".
6. **The outbox claim is not a bottleneck.** Claiming 100 of 10,000 backlog rows takes 1.9 ms, and a full
   claim, mark and commit cycle takes about 5 ms (about 20,000 rows per second for one claimer; 33,000 for four).
   Four competing claimers got no errors.
7. **Operational finding:** Docker gives Postgres only 64 MB of `/dev/shm` by default, and the repo's compose file
   does not change that. Parallel search queries at 8 concurrent clients failed with "could not resize shared
   memory segment ... No space left on device" (seen once, in a short run). The benchmark container used
   `--shm-size=256m`. The compose file should set `shm_size: 256mb` (not changed here).

**What this means for the design:** the single-row lock per conversation is the right trade for correctness
(gap-free, ordered seqs) and the ceiling is far above what a real chat produces (a group where 1,000 people
each send one message a minute is about 17 messages per second). If a hot conversation ever needed more, the
first thing to try is fewer round trips inside the lock (see "The per-conversation lock").

## Environment

| Item                     | Value                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine                  | MacBook Air (Mac15,13), Apple M3, 8 cores (4 performance + 4 efficiency), 16 GB RAM, macOS 27.0.1                                                              |
| Container runtime        | Colima (macOS Virtualization.framework, virtiofs), Docker 29.2.1, VM: aarch64 Ubuntu 24.04, **6 CPUs, 12 GiB RAM** (`docker info`)                             |
| Database                 | `postgres:17-alpine`, PostgreSQL 17.11, one container, no replica                                                                                              |
| Postgres settings        | Same as `infra/docker/compose.yml`: defaults plus `shared_preload_libraries=pg_stat_statements`, `pg_stat_statements.track=all`                                |
| Defaults that matter     | `shared_buffers` 128 MB, `work_mem` 4 MB, `max_connections` 100, `max_parallel_workers_per_gather` 2, `fsync` on, `synchronous_commit` on, `max_wal_size` 1 GB |
| Differences from compose | `--shm-size=256m` (compose uses Docker's 64 MB default, see finding 7); data in the container's own layer, not a named volume                                  |
| Client                   | Node v26.8.1 (the repo needs 22 or newer), `pg` pool of 20 connections (the API default `DATABASE_POOL_MAX`), `tsx`, same machine as the database              |
| Data                     | `npm run seed -- --scale large`: 1,000 users, 3,202 conversations, 1,000,000 messages (570 MB with indexes), then `VACUUM ANALYZE`                             |
| Extra fixture            | One synthetic user `bench_many_chats` who is a member of 1,000 conversations (the seed's busiest user is in 23)                                                |

The machine was an ordinary working laptop, not an idle one. During the runs macOS background work
(`mediaanalysisd` at about one full core, WindowServer, Chrome) kept the load average near 10 on 8 cores, and
the benchmark client and database share the same CPUs. Nobody else was running benchmarks.

## Method

- Script: [`scripts/bench/db/benchmark.ts`](../../scripts/bench/db/benchmark.ts) (scenarios), `harness.ts` (timing),
  `fixtures.ts` (test data), `explain.ts` (plans). It calls the real `@chat/db` functions:
  `allocateSeqAndInsertMessage`, `keysetHistory`, `buildChatListQuery`, `buildOutboxClaimQuery`, `advanceReadSeq`,
  `advanceCursor`, `recipientCursors` + `receiptWatermarks`, `searchMessages`. The membership check is the same SQL as
  `requireMember` in the API.
- Run it: build the db package once (`npx tsc -p packages/database/tsconfig.build.json`), then
  `DATABASE_URL=... BENCH_CONTAINER=<postgres container name> npx tsx scripts/bench/db/benchmark.ts --tag name`.
- Each scenario: 200 warm-up iterations (not counted), then a measured phase that ends when **both** 2,000 iterations
  and 8 seconds are reached, with a hard stop at 30 seconds. Repeated 3 times. Slow scenarios (the common-word
  searches) hit the 30 second stop before 2,000 iterations; the "iterations" column in the raw files shows the
  real count (for example 295 for j1 at one client).
- "c" is the number of concurrent workers. Latency is timed in Node with `process.hrtime.bigint()` around the
  whole call, so it includes the connection pool wait, the network hop to the VM and result parsing. Tables show the
  **median of the 3 runs** for each figure, and for queries per second also the lowest and highest run.
- Reads run first on the untouched seed, then cursors, outbox and duplicates, and the two write scenarios (a, b) last, so the
  new messages do not change what the reads see. Search test messages contain no searched word.
- Before each outbox run the table is reset to exactly 10,000 unpublished rows. Before the write scenarios all
  unpublished outbox rows are marked published (as a running dispatcher would).
- The Postgres container is sampled with `docker stats` about every 2 seconds. CPU is a percentage of one core of the
  VM (300 means three cores busy). The pool is sampled every 20 ms.
- Statistics are reset (`pg_stat_reset`) before the first scenario, so index usage covers the whole run.

## Results

Main run, 2026-10-24, tag `baseline` (file `scripts/bench/db/results/2026-10-24-baseline.{json,csv}`).
Times are milliseconds. "qps" is queries per second: median (lowest-highest of 3 runs).

### Sending messages (a, b, c)

| Scenario                                            | c   | qps (range)      | avg  | p50  | p95  | p99  | max | Postgres CPU (% of a core) | pool in use (max / waiting) |
| --------------------------------------------------- | --- | ---------------- | ---- | ---- | ---- | ---- | --- | -------------------------- | --------------------------- |
| (a) send, distinct conversations                    | 1   | 364 (272-389)    | 2.75 | 2.24 | 5.13 | 9.99 | 92  | 29                         | 1 / 0                       |
| (a) send, distinct conversations                    | 8   | 898 (842-1143)   | 8.91 | 6.52 | 19.6 | 38.4 | 167 | 154                        | 8 / 0                       |
| (a) send, distinct conversations                    | 32  | 1372 (1237-1558) | 23.3 | 19.1 | 47.3 | 75.9 | 237 | 231                        | 20 / 12                     |
| (b) send, ONE hot conversation                      | 1   | 453 (330-559)    | 2.21 | 1.96 | 3.29 | 6.14 | 58  | 28                         | 1 / 0                       |
| (b) send, ONE hot conversation                      | 8   | 559 (535-574)    | 14.3 | 10.8 | 35.4 | 56.9 | 189 | 45                         | 8 / 0                       |
| (b) send, ONE hot conversation                      | 32  | 471 (374-517)    | 67.6 | 52.8 | 156  | 257  | 541 | 55                         | 20 / 12                     |
| (c) duplicate (same `client_message_id`), 200 chats | 1   | 390 (342-436)    | 2.56 | 1.81 | 6.21 | 14.0 | 82  | 22                         | 1 / 0                       |
| (c) duplicate (same `client_message_id`), 200 chats | 8   | 1448 (1433-1464) | 5.52 | 4.62 | 9.97 | 19.1 | 128 | 135                        | 8 / 0                       |

- At c=32 the pool (20 connections) is full and 12 requests wait in the pool queue, so the c=32 latency includes that
  queue. In (b) the extra senders wait for the row lock instead, which is why latency grows from 2.2 ms to 68 ms while
  throughput stays flat.
- Postgres memory stayed between 210 and 314 MiB in every run. The Postgres CPU in (a) rises with concurrency (up to
  about 2.3 cores); in (b) it stays near half a core because the work is serialised.
- A duplicate costs about as much as a new send (2.6 ms against 2.75 ms at c=1): it still takes the lock, tries the
  insert, rolls back and reads the original.

### Reads (d, e, f, i, j)

| Scenario                                               | c   | qps (range)      | avg  | p50  | p95  | p99  | max  |
| ------------------------------------------------------ | --- | ---------------- | ---- | ---- | ---- | ---- | ---- |
| (d1) history: latest 50 of the 50 busiest chats        | 1   | 1356 (1269-1551) | 0.74 | 0.56 | 1.54 | 3.38 | 31   |
| (d1)                                                   | 8   | 3278 (2704-3567) | 2.44 | 2.05 | 5.15 | 8.04 | 48   |
| (d2) history: deep keyset page (seq < 1,800 of 3,600)  | 1   | 1598 (1378-1674) | 0.63 | 0.56 | 0.90 | 1.90 | 9    |
| (d2)                                                   | 8   | 2514 (2510-2999) | 3.18 | 2.46 | 6.57 | 11.5 | 171  |
| (d3) history: oldest page (seq < 60)                   | 1   | 459 (115-564)    | 2.18 | 1.60 | 4.19 | 9.06 | 104  |
| (d3)                                                   | 8   | 1069 (1005-1731) | 7.48 | 4.64 | 16.9 | 40.8 | 226  |
| (e1) chat list, 23 chats (the seed's maximum)          | 1   | 958 (590-971)    | 1.04 | 0.80 | 1.81 | 4.92 | 119  |
| (e1)                                                   | 8   | 527 (334-1803)   | 15.2 | 4.10 | 58.6 | 166  | 339  |
| (e2) chat list, 1,000 chats (synthetic user)           | 1   | 291 (186-298)    | 3.44 | 2.96 | 5.42 | 10.3 | 135  |
| (e2)                                                   | 8   | 266 (262-373)    | 30.0 | 24.7 | 59.0 | 118  | 229  |
| (f) membership check                                   | 1   | 2123 (1360-2162) | 0.47 | 0.38 | 0.90 | 1.96 | 80   |
| (f)                                                    | 8   | 5290 (4351-5622) | 1.51 | 1.09 | 2.94 | 7.22 | 172  |
| (i1) receipts, 12-member group                         | 1   | 1428 (1045-1520) | 0.70 | 0.63 | 1.08 | 1.91 | 20   |
| (i1)                                                   | 8   | 4078 (3253-4151) | 1.96 | 1.64 | 3.76 | 7.74 | 300  |
| (i2) receipts, 600-member group                        | 1   | 618 (606-690)    | 1.62 | 1.42 | 2.51 | 4.49 | 10   |
| (i2)                                                   | 8   | 1388 (1348-1599) | 5.76 | 4.79 | 11.0 | 17.6 | 123  |
| (j1) search "need" (common), user in 23 chats          | 1   | 9.8 (9.3-10.8)   | 102  | 93.5 | 153  | 209  | 311  |
| (j1)                                                   | 8   | 14.2 (11.7-16.0) | 560  | 510  | 980  | 1237 | 1822 |
| (j2) search "hello" (rare, 519 hits), user in 23 chats | 1   | 461 (317-484)    | 2.17 | 1.80 | 3.80 | 5.81 | 87   |
| (j2)                                                   | 8   | 1115 (1021-1141) | 7.17 | 5.70 | 14.7 | 29.0 | 158  |
| (j3) search "need", user in 1,000 chats                | 1   | 7.5 (7.1-9.7)    | 133  | 115  | 233  | 436  | 464  |
| (j3)                                                   | 8   | 28.9 (28.3-30.0) | 277  | 251  | 413  | 531  | 620  |
| (j4) search "need" inside one chat                     | 1   | 120 (116-131)    | 8.34 | 7.61 | 13.5 | 17.5 | 104  |
| (j4)                                                   | 8   | 308 (279-413)    | 25.7 | 20.4 | 47.7 | 116  | 248  |

Notes: the chat list sorts in memory and pages in the API, so `limit 1000` rows are read for the 1,000-chat user. The
d3 and e1 runs show how noisy this machine is (d3 at c=1: 115 to 564 per second across the 3 runs).

### Cursors and outbox (g, h)

| Scenario                                                      | c   | qps (range)      | avg  | p50  | p95  | p99  | max |
| ------------------------------------------------------------- | --- | ---------------- | ---- | ---- | ---- | ---- | --- |
| (g1) read cursor update (`advanceReadSeq`)                    | 1   | 1658 (1460-1954) | 0.60 | 0.43 | 1.34 | 3.21 | 74  |
| (g1)                                                          | 8   | 5953 (5337-6541) | 1.34 | 1.14 | 2.45 | 4.38 | 77  |
| (g2) delivered cursor update (`advanceCursor`)                | 1   | 1986 (1897-2270) | 0.50 | 0.44 | 0.72 | 1.66 | 15  |
| (g2)                                                          | 8   | 4497 (3725-4995) | 1.78 | 1.35 | 3.82 | 8.80 | 97  |
| (h1) claim 100 of 10,000 rows, rolled back (pure claim cost)  | 1   | 515 (396-608)    | 1.94 | 1.40 | 4.12 | 7.87 | 183 |
| (h1)                                                          | 4   | 1439 (1246-1501) | 2.78 | 2.26 | 5.47 | 8.84 | 79  |
| (h2) claim 100 + mark published + commit (a producer refills) | 1   | 199 (155-271)    | 5.03 | 3.40 | 10.4 | 29.1 | 395 |
| (h2)                                                          | 4   | 332 (308-507)    | 12.0 | 8.34 | 26.9 | 55.1 | 146 |

- The cursor scenarios call the function on cursors that are already at their cap after the first call. Postgres still
  writes a new row version, so this is the real write cost of an ack that does not advance the cursor.
- (h1) rolls back so every claim sees the same 10,000-row backlog and four claimers skip each other's locked rows.
  (h2) is what the dispatcher does without the emit step (the real dispatcher also emits to Socket.IO inside the
  transaction). In (h2) each claim moves 100 rows, so 199 claims per second is about 20,000 rows per second, and 332 per
  second with four claimers is about 33,000 rows per second. No errors, no duplicate claims. The sum of all four claimers is
  only 1.7x one claimer: they compete for the same oldest rows and for the one `UPDATE`.

## Query plans (EXPLAIN ANALYZE, BUFFERS)

Captured by [`scripts/bench/db/explain.ts`](../../scripts/bench/db/explain.ts) using the SQL and parameters that the real helpers send, on
the freshly seeded database (second execution, warm cache). Each file in [`query-plans/`](query-plans/) starts with the SQL and the
parameters. "Scanned" is the rows the index returned; "returned" is the rows the query returned.

| Query                                                        | Index used                                                                            | Scanned / returned | Buffers        | Time      | Flags                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------ | -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History, latest 50 (`history-latest`)                        | `messages_conversation_seq_uq` (backward)                                             | 51 / 51            | 54 hit         | 0.04 ms   | Seq scan on `hidden_messages` (empty table, so it costs nothing here; its primary key `(user_id, message_id)` would be used once it has rows)                        |
| History, deep page (`history-deep`)                          | same                                                                                  | 51 / 51            | similar        | 0.04 ms   | same note                                                                                                                                                            |
| Sync forward (`history-sync-forward`)                        | same                                                                                  | 201 / 201          | 13 hit         | 0.11 ms   | none                                                                                                                                                                 |
| Chat list, 23 chats (`chat-list-23`)                         | `conversation_members_user_idx`, hash join                                            | 23 / 23            | small          | 0.31 ms   | Seq scan on `conversations` (3,202 rows, 0.1 ms) and an in-memory sort of 23 rows; fine at this size                                                                 |
| Chat list, 1,000 chats (`chat-list-1000`)                    | `conversation_members_user_idx` bitmap scan                                           | 1,000 / 1,000      | 93 hit         | 0.93 ms   | Seq scan on `conversations` (3,202 rows) and a 157 kB quicksort of 1,000 rows. At millions of conversations the planner would switch to index lookups (not measured) |
| Membership (`membership-check`)                              | `conversation_members_pkey`                                                           | 1 / 1              | 3 hit          | 0.01 ms   | none                                                                                                                                                                 |
| Outbox claim (`outbox-claim`, 10,000 backlog)                | `outbox_unpublished_idx`                                                              | 100 / 100          | 205 hit        | 0.05 ms   | none: `LockRows` over an index scan in `id` order; no sort                                                                                                           |
| Receipts, 600 members (`receipts-recipient-cursors`)         | `conversation_members_pkey`, `device_cursors_conversation_idx`, seq scan on `devices` | 600 / 599          | 37 hit         | 0.69 ms   | Seq scan on `devices` (1,005 rows) and a 599-row sort; fine now, `devices` grows with users                                                                          |
| Read cursor update (`read-cursor-update`)                    | `conversation_members_pkey`, `conversations_pkey`                                     | 1 / 1              | 20 hit, 1 read | 0.22 ms   | none                                                                                                                                                                 |
| Search, rare word (`search-rare-before-0010`)                | `messages_search_idx` (GIN bitmap)                                                    | 519 hits / 20      | small          | 1.1 ms    | top-N sort of the 5 hits                                                                                                                                             |
| Search, common word (`search-common-before-0010`)            | `messages_search_idx` inside a per-chat loop                                          | 86,263 x 23 / 20   | 1,559 hit      | **71 ms** | **The problem**: the GIN scan of the word's 86,263 postings is repeated for each of the user's 23 chats (`loops=23`), about 5.5 ms each. Top-N sort of 1,102 rows    |
| Search, common word, one chat (`search-in-chat-before-0010`) | `messages_search_idx` bitmap AND                                                      | 86,263 scan / 328  | small          | 5.6 ms    | same cause                                                                                                                                                           |

Plans after migration 0010 are `*-after-0010.txt` (taken later, when the table had grown to about 1.6 million rows after the
benchmark inserts): common word 2.6 ms, rare word 0.2 ms, in-chat 0.47 ms. The 1,000-chat user (`search-common-1000-chats-*`)
is 75 ms in both.

### Index usage over the whole run (`pg_stat_user_indexes`, reset before the run)

| Index                                                                                      | Scans             | Size        | Note                                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `messages_conversation_seq_uq`                                                             | 1,303,460         | 70 MB       | history, search loops, the unique `(conversation_id, seq)`                                |
| `messages_search_idx`                                                                      | 961,457           | 39 MB       | search (replaced by migration 0010)                                                       |
| `messages_sender_device_client_id_uq`                                                      | 193,804           | 106 MB      | idempotency check on every send (the biggest index in the database)                       |
| `conversation_members_pkey` / `_active_idx` / `_user_idx`                                  | 714k / 144k / 58k | under 1 MB  | membership, fan-out, chat list                                                            |
| `outbox_unpublished_idx`, `outbox_pkey`                                                    | 63,456, 17,075    | 9 MB, 23 MB | claims and marking published                                                              |
| `device_cursors_pkey`, `device_cursors_conversation_idx`                                   | 2.26M, 51k        | under 1 MB  | acks, receipts                                                                            |
| **Never used in the run:** `messages_pkey`                                                 | 0                 | 41 MB       | Needed: primary key, and the foreign-key target for reactions, pins, polls and so on      |
| `outbox_event_id_uq`                                                                       | 0                 | 30 MB       | Needed: makes the event id unique. It is the write cost of the outbox, 30 MB at 1.5M rows |
| `outbox_published_at_idx`                                                                  | 0                 | 3.6 MB      | Needed by the 7-day retention delete, which the benchmark does not run                    |
| `users_display_name_trgm_idx`                                                              | 0                 | 0.5 MB      | Needed by people search, not benchmarked                                                  |
| 42 more indexes under 0.2 MB each (calls, reports, push, invites, pins, stars, audit, ...) | 0                 | tiny        | Those features were not exercised                                                         |

Nothing is a candidate to drop on this evidence: every never-used index is either a constraint or serves a job or
feature the benchmark did not run. The write cost that does matter is on `messages`: four indexes (primary key 41 MB,
`(conversation_id, seq)` 70 MB, `(sender_device_id, client_message_id)` 106 MB, search 39 MB) are updated by every send.
Together they are 256 MB, next to a 463 MB table, after 1.5 million messages.

Server-side means from `pg_stat_statements` (the benchmark run): the search select 52 ms (45,499 calls, most of the
total database time, from j1 and j3); `UPDATE conversations SET last_seq` 4.4 ms (148,713 calls, mostly lock wait in
scenario b); chat list 0.97 ms; outbox claim 0.49 ms; receipts query 0.35 ms; `INSERT INTO messages` 0.24 ms.

## Optimisation experiment: search index (kept, migration `0010_perf`)

**Evidence.** The common-word search used the pattern shown above: the planner loops over the user's chats and, for each
chat, scans the whole posting list of the word in the GIN index (86,263 rows) to keep only that chat's rows. Search
queries only ever look inside the user's own chats, so the index should be organised by chat.

**Change (the only one tried for search).** Replace `GIN (search)` with `GIN (conversation_id, search)` using the
`btree_gin` extension, under the same name `messages_search_idx`. A scratch rehearsal on the benchmark database
(before writing the migration) built it in 2.6 s for about 1.6 million messages. Same SQL in the application: nothing in
the code changed.

**Before and after, same database, same machine, 3 runs each (median).** Before is the `baseline` run; after is run
`search-new-index`, made right after swapping the index.

| Scenario                              | c   | Before: qps / avg ms / p99 ms | After: qps / avg ms / p99 ms |
| ------------------------------------- | --- | ----------------------------- | ---------------------------- |
| (j1) "need", user in 23 chats         | 1   | 9.8 / 102 / 209               | **303 / 3.30 / 7.44**        |
| (j1)                                  | 8   | 14.2 / 560 / 1237             | 1152 / 6.94 / 16.7           |
| (j2) "hello" (rare), user in 23 chats | 1   | 461 / 2.17 / 5.81             | 1199 / 0.83 / 1.98           |
| (j2)                                  | 8   | 1115 / 7.17 / 29.0            | 4070 / 1.96 / 7.76           |
| (j3) "need", user in 1,000 chats      | 1   | 7.5 / 133 / 436               | 13.3 / 74.9 / 118            |
| (j3)                                  | 8   | 28.9 / 277 / 531              | 40.4 / 197 / 409             |
| (j4) "need" inside one chat           | 1   | 120 / 8.34 / 17.5             | 1008 / 0.99 / 2.06           |
| (j4)                                  | 8   | 308 / 25.7 / 116              | 3185 / 2.51 / 8.38           |

**Cost of the change.** Measured, not estimated:

| Measure                                                                              | Old index (`GIN (search)`) | New index (`GIN (conversation_id, search)`) |
| ------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------- |
| Index size (`pg_relation_size`, about 1.6M messages)                                 | 39 MB                      | 44 MB (+13%)                                |
| Server time of `INSERT INTO messages` (`pg_stat_statements` mean, 100k inserts each) | 0.254 ms                   | 0.301 ms (+0.047 ms, +18%)                  |
| Send throughput, distinct conversations, c=1                                         | 398 (293-403) per second   | 445 (437-529)                               |
| c=8                                                                                  | 1760 (1518-1820)           | 1471 (1041-1677)                            |
| c=32                                                                                 | 2172 (1930-2272)           | 1936 (1695-2153)                            |

The throughput ranges overlap and c=1 went the other way, so the throughput change is inside this machine's noise. The
server-side insert time is the cleaner measure: about 0.05 ms more per message. It is a trade of roughly 10 to 15% less
insert headroom under heavy concurrency for searches that are 3 to 30 times faster. Decision: **kept**, since a send at 1,372
per second is nowhere near the limit that a real chat needs, while a 100 ms search blocks the user. The migration states in
a comment that the build blocks writes for a few seconds. `down` restores `GIN (search)`. The migration test checks both
directions and `npm test -w @chat/db` passes (41 tests).

### What is not fixed

A user in 1,000 chats searching a common word still takes 75 ms (133 ms before). Their chats cover a third of all
messages, so the planner correctly prefers one big GIN scan with a hash join (plan `search-common-1000-chats-after-0010`),
reading 38,000 buffers. Such users do not exist in the seed (the maximum is 23) and the product has no reason to produce them;
I did not try a second change.

## The per-conversation lock

`allocateSeqAndInsertMessage` takes the row lock on `conversations` with its first statement and keeps it until `COMMIT`.
Everything between is: insert the message, check membership, insert the outbox row, commit.

| Run (tag)                                                                                           | c=1           | c=8              | c=32             |
| --------------------------------------------------------------------------------------------------- | ------------- | ---------------- | ---------------- |
| Hot conversation (b), main run                                                                      | 453 (330-559) | 559 (535-574)    | 471 (374-517)    |
| Hot conversation (b), second sample (`hot-sync-on`)                                                 | 360 (353-398) | 534 (467-545)    | 561 (536-586)    |
| Hot conversation (b), `synchronous_commit = off` (`hot-sync-off`, experiment, not a recommendation) | 473 (447-475) | 642 (621-678)    | 516 (516-524)    |
| Distinct conversations (a), `synchronous_commit = off` (`distinct-sync-off`)                        | 455 (448-459) | 2135 (1932-2292) | 2625 (2048-2628) |

- **Ceiling for one conversation on this setup: about 450 to 650 messages per second**, reached at 8 concurrent senders
  and not improved at 32. Past that, extra senders only wait: p99 goes from 3.3 ms (1 sender) to 156 ms (32 senders).
- Time per send at one sender is about 2 ms. With the disk flush removed it is still about 2 ms at one sender, so the
  lock is held mostly for client-to-database round trips (here across the Mac-to-VM hop), not for the flush. Distinct
  conversations gain more from removing the flush (2,135 per second at c=8 against 898 and 1,760 in the two normal samples),
  because they can overlap their flushes, while the single hot conversation cannot.
- On a real deployment the API and database are in the same region, and a round trip is usually slower than the
  Mac-to-VM hop, so the lock would be held longer and the ceiling would be **lower**, not higher (estimate, not measured).
- What this means: a group would need to average over 400 messages a second to hit the limit, and the cost of hitting it is
  waiting (latency), not failure or lost order. If it ever mattered, the options in order of effort are: fewer round trips
  inside the lock (fold the membership check and the outbox insert into the same statements, or use one database function),
  keeping the API next to the database, then splitting a conversation's seq space. None was tried here, since the evidence
  says the ceiling is far above need. `synchronous_commit = off` would also help distinct conversations but can lose the last
  few commits in a crash, which breaks the "acked means stored" rule, so it is not recommended.

## Limitations

- **One laptop.** Postgres runs in a Colima VM container, the Node client runs on the same machine and shares its CPUs,
  and storage is the VM's disk. This is not production hardware. Absolute numbers will differ; the shapes (index vs
  scan, lock ceiling, search fix) should hold.
- **Noisy machine.** A working laptop with background load (load average near 10 on 8 cores). Repeated runs of the same
  scenario differ by up to 2 to 5 times (for example d3 at c=1: 115 to 564 per second; the same send setup gave 898 and
  1,760 per second at c=8 in two samples). Treat differences smaller than about 2x as noise, and read the shapes, not the digits.
- **Slow scenarios got fewer iterations.** The common-word searches (j1, j3) stopped at the 30 s cap with 227 to 431 measured iterations
  per run, not 2,000.
- **Only 3 repetitions**, medians, no confidence intervals.
- **Synthetic data.** Seeded text with a few thousand distinct words, 3,202 conversations, one device per user. Real data has
  other word distributions and larger tables.
- **Client costs are included** in all latencies (pool wait, Node parsing), while the plan times and `pg_stat_statements` are
  server-only.
- **Not measured:** the real dispatcher's emit step, the HTTP layer, Redis, two API replicas, autovacuum behaviour over long runs,
  a database larger than RAM, replication, the 7-day outbox purge, and the Docker `/dev/shm` failure beyond the single short
  run described in finding 7 (raw output not saved).
- The `/dev/shm` result and the extra "second sample" runs were taken on the same database after earlier benchmark inserts, so it
  held about 1.5 to 1.6 million messages instead of 1 million.

## Redoing the work

```
docker run -d --name chat-dbbench-pg --shm-size=256m -e POSTGRES_USER=chat -e POSTGRES_PASSWORD=chat \
  -e POSTGRES_DB=chat -p 127.0.0.1::5432 -v "$PWD/infra/postgres/initdb:/docker-entrypoint-initdb.d:ro" \
  postgres:17-alpine postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all
export DATABASE_URL=postgres://chat:chat@127.0.0.1:<port>/chat      # port from `docker port chat-dbbench-pg`
npx tsx packages/database/src/migrate.ts up && npx tsx packages/database/src/seed.ts --scale large
npx tsc -p packages/database/tsconfig.build.json                              # the scripts import @chat/db from dist
npx tsx scripts/bench/db/explain.ts                                          # plans, on the fresh seed
npx tsx scripts/bench/db/benchmark.ts --tag mine                             # about 30 minutes
```

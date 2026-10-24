# Status

What exists and what has been checked. An item is **verified** only when a test or command was run for it; the date and
what ran are in the notes. **Built** means merged with tests written by its author, but not re-run for this page.

## Core pipeline

The gate run on 2026-10-24 used throwaway Postgres 17, Redis 7 and MinIO containers. The API integration files run one
after another (`fileParallelism: false`) because they share one Redis, and Socket.IO servers on one Redis form one
cluster.

| Item                                                                        | Status   | Notes                                                                                                                                        |
| --------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres schema, migrations 0001-0007, typed helpers (`packages/database/`) | verified | 2026-10-24: migrations applied to a fresh database; `database` tests pass (41)                                                               |
| Migrations 0008-0010 (calls, privacy, search index)                         | built    | 0010 was applied and measured in the database benchmark run ([`performance/database.md`](performance/database.md))                           |
| Contracts (`packages/contracts`)                                            | verified | 2026-10-24: unit tests pass; `apps/api/test/routes.test.ts` checks every contract endpoint is a real route                                   |
| Messages module: send, history, sync, edits, reactions, receipts, search    | verified | 2026-10-24: `messages.int.test.ts` and the gate tests pass against real Postgres. Search has its own integration tests, not part of the gate |
| Conversations module: direct, group, roles, invites, prefs                  | verified | 2026-10-24: `conversations.int.test.ts` passes; the gate removes a member through the REST endpoint                                          |
| Media module: uploads, GIF proxy, link previews                             | verified | 2026-10-24: `media.int.test.ts` passes against real MinIO. The GIF proxy and link previews were not exercised against the real services      |
| Clerk login                                                                 | verified | 2026-10-24: `auth.int.test.ts` passes with a fake Clerk client. Never run against real Clerk                                                 |
| Socket.IO gateway and in-API dispatcher                                     | verified | 2026-10-24: `realtime.int.test.ts` and the gate tests pass with real Redis                                                                   |
| Worker (pg-boss jobs only)                                                  | verified | 2026-10-24: `apps/worker` integration tests pass (6). Web Push to a real push service is not tested                                          |
| Offline notification: dispatcher queues one `notify` job                    | verified | 2026-10-24: gate test 7 (one job for the offline member, none for muted or online members, none on re-dispatch)                              |
| Prometheus metric names used by alerts and Grafana                          | verified | 2026-10-24: names checked against the code. Values were not checked in a running Prometheus                                                  |
| Infra: compose, Prometheus, Grafana, nginx                                  | built    | Env names and nginx routes were checked against the code. The full stack was not started in the gate run                                     |

## The delivery gate

All run in `apps/api/test/integration/gate.int.test.ts` on 2026-10-24.

| Gate                                                           | Status   | What the test does                                                                                     |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| 1. Duplicate sends make one message                            | verified | 2 tests: sequential, and concurrent over 2 sockets and REST                                            |
| 2. Concurrent sends get unique, ordered seqs                   | verified | 8 senders x 10 messages, seq 1..80, recipients in order                                                |
| 3. A restart after commit, before live delivery, loses nothing | verified | 2 tests: a new API process delivers; an emitted-but-not-marked row is emitted again and deduplicated   |
| 4. An offline client recovers everything                       | verified | 31 events in pages of 7, including edit, delete, reaction and a live message during the sync           |
| 5. Removed members get nothing                                 | verified | No live event; history 403, sync empty plus `removed_conversation_ids`, send refused (socket and REST) |
| 6. Receipts are monotonic and separate                         | verified | Delivered vs read cursors, old acks ignored, an emit alone is not a receipt                            |

## Features

The calls, rich content, chat organisation, notifications/PWA and AI branches were merged on 2026-10-24 and checked by
running the commands in the last column.

| Item                                                                                  | Status   | How it was checked                                                                                                         |
| ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, format and unit tests after the merge                                | verified | `npm run typecheck`, `lint`, `format:check`, `npm test`                                                                    |
| Web build (`livekit-client` stays a separate chunk)                                   | verified | `npm run build -w @chat/web`                                                                                               |
| 1:1 calls are logged once per call from the gateway                                   | verified | `realtime.int.test.ts` (answered and rejected call)                                                                        |
| Dispatcher hands each new message to the @flick bot hook without waiting              | verified | `realtime.int.test.ts`. The live AI reply was not run (no keys)                                                            |
| API integration tests: messages, conversations, calls, ai, realtime, push, auth, gate | verified | Postgres 17 and Redis 7 containers, 9 files, 96 tests passing, one file after another                                      |
| Web client (React, Socket.IO, offline outbox, PWA)                                    | built    | Unit tests next to the code in `apps/web/src`                                                                              |
| Browser journeys (Playwright, `tests/e2e/tests`, 7 files)                             | built    | Has a CI workflow (`.github/workflows/e2e.yml`); not re-run for this page                                                  |
| Database benchmarks and query plans                                                   | verified | 2026-10-24, with method and results in [`performance/database.md`](performance/database.md)                                |
| Load tests (k6)                                                                       | planned  | `npm run load` expects scenarios in `tests/load/scenarios`; none exist yet                                                 |
| Deployment (Vercel, Render, Supabase, S3)                                             | built    | Configuration is in the repo and described in [`operations/deployment.md`](operations/deployment.md). No run recorded here |

Not run in the gate or the merge check: `app.int.test.ts`, behaviour with two API replicas under load, a Redis outage
during traffic, real Clerk, real Web Push, the live AI chain, real GIPHY and link-preview fetches, and the Grafana
dashboards in a running Grafana.

## Known gaps

- `publishOutboxBatch` and `markEventProcessed` (database package) are not used by the apps; they are kept for the
  day a broker is added.
- The `audit_log` table exists and nothing writes it. `users.is_demo` exists and nothing sets it.
- Avatars come from two places: `users.avatar_url` (the Clerk picture) and `avatar_object_key` (an upload). With a
  private bucket and no `S3_PUBLIC_URL` only the Clerk picture is shown.
- A message counts as "delivered" in `messages_delivered_total` when the recipient had a socket at emit time, not when
  the client acked.
- Messages are plaintext on the server ([ADR-0011](decisions/0011-e2e-encryption-deferred.md)). Kafka/Redpanda and
  sharding are deferred ([ADR-0004](decisions/0004-inapi-dispatcher-redpanda-deferred.md),
  [`architecture/sharding-multi-region.md`](architecture/sharding-multi-region.md)).

## Fixed in the gate run (2026-10-24)

- `app.close()` hung while any Socket.IO client was connected; sockets are now disconnected in a `preClose` hook.
- A second dispatch of the same outbox row queued a second `notify` job; the job id is now a fixed hash of (event,
  user).
- Contract paths for upload and download did not match the server (`/media/presign`, `/media/:id/url`).
- compose set `PORT` and `DB_POOL_MAX`; the apps read `API_PORT`, `WORKER_METRICS_PORT` and `DATABASE_POOL_MAX`.
- nginx proxied `/ws` instead of `/socket.io/`, and did not strip the `/api` prefix.
- No `error` listener on the pg pools or on the API's pg-boss: a Postgres restart would have crashed the process.
- The adapter's Redis subscriber connection was never closed, and Redis was closed while sockets were still cleaning up.
- Prometheus alerts and dashboards used metrics that did not exist.
- Building `@chat/api` from stale `dist` folders gave type errors: `tsc -p tsconfig.build.json` reads dependencies from
  their `dist`, so build the packages first (shared, contracts, uploads, link-preview, ai, db), then api and worker.

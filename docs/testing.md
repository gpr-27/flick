# Testing

How to run each test suite, what it proves, and what it did not. Numbers on this page come from runs on 2026-10-25
(commands next to them); nothing here is an estimate.

## Running the suites

Run everything from the repository root. Unit tests need nothing; integration tests need Postgres, Redis and MinIO.

```
npm run format:check && npm run lint && npm run typecheck
npm test                                   # unit tests of every workspace (@chat/db starts its own Postgres)

eval "$(scripts/dev/test-deps-up.sh)"      # throwaway Postgres 17, Redis 7, MinIO; prints the environment
npm run test:integration                   # apps/api and apps/worker
scripts/dev/test-deps-down.sh
```

Notes:

- The API integration files run one after another (`fileParallelism: false`): they share one Redis, and Socket.IO
  servers on one Redis form one cluster.
- `@chat/db` tests use `TEST_DATABASE_URL` when it is set (the `eval` line above sets it) and otherwise start a
  Postgres container themselves.
- The failure-injection file starts and stops its **own** Redis container with the `docker` command (image
  `redis:7-alpine`, a random free port, name `flick-bt-redis-<pid>`). It never touches the Redis of the test stack. If
  `docker` or that image is missing, part (a) is skipped and says so.
- The waits in the API integration tests are multiplied by `TEST_TIME_FACTOR` (default 4) because they wait for the
  dispatcher, which polls every 200 ms; `TEST_TIME_FACTOR=1` gives the strict timings.

| Suite                               | Command (from the folder)                                          | Needs                         |
| ----------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| API unit tests                      | `cd apps/api && npx vitest run`                                    | nothing                       |
| API integration tests               | `cd apps/api && npx vitest run -c vitest.integration.config.ts`    | Postgres, Redis, MinIO        |
| One integration file                | `... -c vitest.integration.config.ts test/integration/security`    | as above                      |
| Database tests                      | `cd packages/database && npx vitest run`                           | Docker or `TEST_DATABASE_URL` |
| Worker integration tests            | `cd apps/worker && npx vitest run -c vitest.integration.config.ts` | Postgres, Redis               |
| Contracts, shared, ai, link-preview | `npm test -w @chat/contracts` (and so on)                          | nothing                       |
| Browser tests                       | `npm run e2e` (see `tests/e2e/README.md`)                          | browsers                      |

## What each API integration file proves

All of them use the full stack as `main.ts` wires it (HTTP routes, Socket.IO gateway, outbox dispatcher) from
`apps/api/test/integration/harness.ts`, with a fake login (two headers; a socket token is the user id). Postgres, Redis,
the Redis adapter and the dispatcher are real.

| File                               | Proves                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content-matrix.int.test.ts`       | Every content type and message state comes back valid (`MessageRecord`) from every read path: chat list, single conversation, history, both sync endpoints, search, pins, starred, the live `new_message` event, and a forward. See below.                        |
| `contract-conformance.int.test.ts` | Each endpoint of `ENDPOINTS` answers a valid call with JSON that its own `response` schema accepts, and every endpoint is a real route. Lists the one endpoint it cannot call.                                                                                    |
| `authorization.int.test.ts`        | A user who never joined, was removed, or left gets 403/404 and no data from every id-taking route (each route is also run by an allowed user, so a wrong fixture cannot pass by accident); blocked users, role limits, media and forwarding rules, no id probing. |
| `validation.int.test.ts`           | 251 hand-written bad inputs get 400 (or 413) in the standard error shape; a sweep of every endpoint with hostile path parameters, query strings and bodies never returns a 5xx and every error has the standard shape.                                            |
| `delivery-contract.int.test.ts`    | Dense unique seqs under concurrency (15 devices, 6 sockets, mixed changes), idempotent retries (concurrent, mixed transports, two replicas), cursors only move forward, edits/deletes/reactions take seqs and sync in order, expiry, view-once, removed members.  |
| `failure-injection.int.test.ts`    | Redis stopped while the API runs; a Postgres connection killed mid-dispatch; two dispatcher replicas on one outbox. Results below.                                                                                                                                |
| `directory.int.test.ts`            | `GET /users/directory` paging: limit 1, every page size, exact page boundary, equal names, case, accents and other alphabets, blocked, disabled and bot users, sign-ups between pages, bad cursors.                                                               |
| `security.int.test.ts`             | Rate limits answer 429 in the standard shape (global, per route, per user, WebSocket, shared between replicas), helmet headers, CORS preflight per method, the real login, `E2E_FAKE_AUTH` refused in production.                                                 |
| `redis-publish.int.test.ts`        | An emit after Redis is lost is not an unhandled rejection.                                                                                                                                                                                                        |

The older files (`messages`, `conversations`, `realtime`, `gate`, `media`, `calls`, `ai`, `auth`, `push`, `privacy`,
`reports`, `app`) are unchanged.

### The content-type matrix

The bug it guards against: the chat list built its own "last message" from raw columns and dropped `type` and
`attachment_id`, so one voice note or photo as the newest message made the whole list fail to parse. The contract's
`ConversationSummary.last_message` has `.catch(null)`, which hides exactly that failure, so the matrix parses
`last_message` with `MessageRecord` directly.

Created, then read back by the receiver and by the sender through every path:

- sent by a client: text (plain, emoji and newlines, 16000 characters, mention, forwarded, reply), image (with and
  without caption, view-once), video (caption, view-once), file, voice (and view-once), gif, sticker, poll;
- states: edited text and edited caption, deleted for everyone (text, voice, photo), deleted for me, expired but not yet
  purged (text, photo), view-once after it was opened (photo, voice), with a reaction;
- written by the server: the @flick bot's text with `ai_provider` and `ai_model` and without, call events (audio and
  video; missed, declined, ended), a started group call, a system message, and every system event a real group action
  writes (created, added, renamed, role changed, timer changed, removed, left);
- a poll vote returns a valid tally and is never a message row.

### Bugs this work found (all fixed)

| #   | Bug                                                                                                                                                                                                                           | Where                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | The chat list's last message was a different, hand-made record: it showed text of expired messages and messages the viewer deleted for themselves, and leaked other people's `client_message_id`.                             | `apps/api/src/modules/conversations/repo/summaries.ts` (now uses `toRecords`)                 |
| 2   | The chat list showed **no preview** whenever the newest thing in the chat was a reaction, an edit or a delete (they take a seq but are not message rows).                                                                     | same file (newest message per chat, found by `ORDER BY seq DESC LIMIT 1`)                     |
| 3   | Search returned the caption of a view-once photo the reader had already opened.                                                                                                                                               | `apps/api/src/modules/messages/domain/search.ts`                                              |
| 4   | Forwarding a photo, video, file or voice note received from someone else failed with 404 (the attachment must belong to the sender). Forwarding now works, only for files already in a chat the sender is in.                 | `packages/database/src/queries/messages.ts`                                                   |
| 5   | Reporting a user that does not exist was a 500.                                                                                                                                                                               | `apps/api/src/modules/users/http/routes.ts`                                                   |
| 6   | Malformed JSON and a body over 1 MB on message routes were a 500 (the messages module turned Fastify's 400/413 into INTERNAL).                                                                                                | `apps/api/src/modules/messages/errors.ts`                                                     |
| 7   | A NUL character (`\u0000`) in any text, query or cursor was a 500 (Postgres cannot store it). Now a 400.                                                                                                                      | `apps/api/src/app.ts` (`preValidation` hook), `http-error.ts`, `conversations/repo/cursor.ts` |
| 8   | A bad `/blocks` cursor (valid base64, wrong content) was a 500.                                                                                                                                                               | `apps/api/src/modules/users/http/routes.ts`                                                   |
| 9   | Error bodies were not in one shape: Fastify errors, 404s, 401s, 429s and the AI and link-preview plugins answered `{ error: { message } }` or `{ error: "name" }` without `code` and `retryable`.                             | `apps/api/src/http-error.ts`, `app.ts` (error handler and an `onSend` hook)                   |
| 10  | The user directory could list a person twice or loop forever at a page boundary for names like `İstanbul` or `ΑΣ` (JavaScript and Postgres lower-case them differently). The cursor now carries the database's own sort keys. | `apps/api/src/modules/users/repo/users.ts`, `http/routes.ts`                                  |
| 11  | **Redis down would have ended the API process**: the Socket.IO adapter's unawaited `publish()` became an unhandled rejection on the first broadcast.                                                                          | `apps/api/src/ws.ts`                                                                          |
| 12  | **Redis not answering made every request take about 10 s** (the rate limiter runs on every request and waited for ioredis' connect timeout). Commands now give up after 1 s.                                                  | `apps/api/src/redis.ts`                                                                       |
| 13  | **A Postgres connection cut while a client was checked out and idle** (between statements of a transaction, as the dispatcher is while it emits) was an uncaught exception that ends the process.                             | `packages/database/src/db.ts`                                                                 |

Each has a test that fails without the fix (the two process-ending ones were checked by switching the fix off).

## Failure injection

`apps/api/test/integration/failure-injection.int.test.ts`. Machine: a laptop running Docker Desktop with other jobs
running at the same time, so the absolute times are only indicative.

### (a) Redis goes down while the API runs

A real Redis container is stopped with `docker stop` and started again.

| Step                                                        | Result                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Five REST sends and one Socket.IO send while Redis is down  | All committed (HTTP 200 / `ok: true`), seqs dense. Each REST send took about 1 s (rate limiter waiting for Redis, then failing open). |
| History, chat list, delivery acks, sync while Redis is down | Work (Postgres only). Sync returns every message sent during the outage.                                                              |
| Redis started again                                         | ioredis reconnects and the adapter resubscribes by itself; a new message reaches the live client; sync fills in whatever was missed.  |
| Outbox afterwards                                           | No row left unpublished.                                                                                                              |

Before the fixes (bugs 11 and 12), measured with a standalone script and a probe test:

- one `io.to(room).emit()` with Redis gone left an `UnhandledRejection: MaxRetriesPerRequestError`, which ends a Node
  process that has no handler (`apps/api/src/main.ts` has none);
- a probe of 18 requests while Redis did not answer: the first three took 0.25, 1.5 and 5.0 s, then
  9.1 to 11.4 s each for `GET /users/me`, history and send. After the fix: 0.5 to 1.2 s for all 18.

So the claim in [ADR-0005](decisions/0005-redis-ephemeral-only.md) holds, and after these fixes it is tested. One thing
is **not** tested: the dispatcher drops a row after 20 failed attempts and leaves it to sync. With the backoff formula
(a random fraction of `min(10 s, 0.2 s * 2^(n-1))`) the 19 waits before the 20th attempt add up to about 70 s on average
(computed, not measured), so a Redis outage longer than that loses the live event and the offline push for messages sent
at its start; the messages themselves are stored and returned by sync.

### (b) A Postgres connection is killed in the middle of a dispatch round

The dispatcher's backend is killed with `pg_terminate_backend` right after it emitted the first message of a round, before
the round committed. Result: the round fails and is logged, the 12 outbox rows stay unpublished, the next round emits
them again, and every row ends up published. The client received more than 12 `new_message` events (at least one
repeat) and held exactly seqs 1 to 12 once it dropped repeats by `seq`: nothing lost, repeats allowed, as the
at-least-once contract says. A second test cuts every connection of the API's pool; after one retry (what the client
outbox does) sends and live delivery work again, and the retried `client_message_id` is still a duplicate.

### (c) Two dispatcher replicas on one outbox

| Case                                                                | Result                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One dispatcher, 250 queued messages of one conversation             | Emitted strictly in `seq` order.                                                                                                                                   |
| Two dispatchers, 300 queued messages                                | Every message emitted once; none claimed by both (`SKIP LOCKED` works).                                                                                            |
| Two dispatchers, one slowed down while it holds the oldest 100 rows | **Not in order**: the faster replica delivers later seqs first. The set is complete, and sync from the client's last gapless seq returns the exact range in order. |

So with more than one dispatcher the order of live events is **not guaranteed; the client resync repairs it** (a jump in
`seq` makes the client sync and it drops repeats). The third test asserts the overtaking on purpose, to keep this
documented; if the dispatcher is ever changed to keep one conversation in order across replicas, change that assertion
to "in order" and update the architecture overview.

## Coverage

Command, on 2026-10-25, with `@vitest/coverage-v8` 5.0.5 (added as a root dev dependency; the repository had none):

| Suite                   | Command                                                                    | Tests run                         | Statements | Branches | Functions | Lines  |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------- | ---------- | -------- | --------- | ------ |
| `apps/api`, unit        | `cd apps/api && npx vitest run --coverage`                                 | 53 (10 files)                     | 18.25%     | 11.95%   | 13.96%    | 19.84% |
| `apps/api`, integration | `cd apps/api && npx vitest run -c vitest.integration.config.ts --coverage` | 1313 passed, 1 skipped (21 files) | 90.89%     | 82.7%    | 93.34%    | 93.5%  |
| `packages/database`     | `cd packages/database && npx vitest run --coverage`                        | 48 (8 files)                      | 77.67%     | 64.24%   | 85.91%    | 79.72% |

Coverage is measured over `src/**/*.ts`. The unit run is low because the API's logic is tested against a real database in
the integration suite; the integration run is the number that describes the API. Files with the least coverage in the
integration run: `src/main.ts` (0%, the start-up script), `modules/health/domain/readiness.ts` and `health/http/routes.ts`
(readiness is covered by the unit tests, which are not part of that run), `modules/gateway/calls.ts` (73%, call signalling
edge cases), `modules/auth/clerk.ts` (60%, the real Clerk calls). In `packages/database` the uncovered code is `migrate.ts`
(the command-line entry), `config.ts` and the seed script's reset and report paths.

## Test counts

Before this work (base commit `3d1253e`) and after, from the runs of 2026-10-25:

| Suite                     | Before | After                  |
| ------------------------- | ------ | ---------------------- |
| `apps/api` unit           | 42     | 53                     |
| `apps/api` integration    | 119    | 1313 passed, 1 skipped |
| `packages/database`       | 39     | 48                     |
| `apps/worker` integration | 6      | 6                      |

## What is not tested here

- Real Clerk, real GIPHY, real link-preview fetches (the SSRF guard refuses loopback, so no local fixture works; the error
  path is checked), real Web Push, real LiveKit servers (tokens are signed locally), the live AI chain.
  `GET /link-preview` is the one endpoint the conformance test does not call with valid input.
- A Postgres server that goes away entirely (only connections are killed), two API replicas under load, a dispatcher row
  that fails 20 times.
- The web client's own gap detection and sync (it is in `apps/web`; the tests here check that the server side of the
  repair works).
- Behaviour of `GET /health/ready` while Redis is down.

# Flick

Flick is a real-time chat app I built to learn how messaging systems stay correct: no lost messages, no duplicates,
the right order, and a way back after a disconnect. It has 1:1 and group chat, media, calls, an installable web app and
an AI bot. The part I care about most is the delivery pipeline.

<p>
  <img src="docs/screenshots/chat-list.png" width="32%" alt="Chat list" />
  <img src="docs/screenshots/conversation-ticks.png" width="32%" alt="A conversation with delivery ticks" />
  <img src="docs/screenshots/group-info.png" width="32%" alt="Group info" />
</p>

## What it does

- **Chat:** direct chats and groups (roles, invite links), edit, delete, reactions, replies, forward, mentions, pin and
  star messages, search (Postgres full-text), drafts.
- **Receipts and presence:** sent, delivered and read are separate states. Online, typing and last seen.
- **Offline:** a client that was away catches up with one sync call. The installable app (PWA) keeps an offline outbox
  and gets Web Push notifications.
- **Content:** images, files, voice notes with a waveform, polls, GIFs and stickers, link previews, disappearing
  messages, view-once.
- **Organising chats:** archive, pin, mute, favourites, wallpapers, chat lock.
- **Calls:** 1:1 calls over WebRTC, group calls and call links through LiveKit.
- **AI:** summarise unread messages, suggest replies, translate, and an `@flick` bot that answers in the chat.

## How a message is delivered

1. The client sends the message with a `client_message_id` it makes once and reuses on every retry.
2. The API opens one Postgres transaction: it checks membership, takes the next `seq` for the conversation, inserts the
   message and an **outbox** row, then commits and acks the sender. A retry returns the message that already exists.
3. A **dispatcher** inside the API claims unsent outbox rows and emits them to the current members over Socket.IO.
4. The recipient drops events it already has (by `seq`) and acks with a delivered cursor. Read is a separate cursor.
5. After a disconnect or an API restart the client calls **sync** with its last `seq` per conversation and gets what it
   missed from Postgres.

That is at-least-once delivery made safe with idempotency. The full contract is in
[`docs/architecture/delivery-guarantees.md`](docs/architecture/delivery-guarantees.md), and the reasons behind each
choice are short decision records in [`docs/decisions/`](docs/decisions/README.md).

## Stack

| Part      | Choice                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| Web       | React, TypeScript, Vite, TanStack Query, Zustand; installable (PWA)             |
| API       | Node.js 22, Fastify, Socket.IO (Redis adapter)                                  |
| Database  | PostgreSQL 17, the source of truth, with a transactional outbox                 |
| Jobs      | pg-boss in a worker (push notifications, expiring messages, cleanup)            |
| Redis     | Socket.IO adapter, presence, rate limits; never durable                         |
| Login     | Clerk                                                                           |
| Files     | S3-compatible storage with signed URLs (MinIO locally, AWS S3 when deployed)    |
| Calls     | WebRTC with coturn for 1:1, LiveKit for groups                                  |
| Tests     | Vitest, integration tests on real Postgres/Redis/MinIO, Playwright              |
| Monitoring | Prometheus and Grafana                                                         |

Kafka/Redpanda is not used. It is deferred until there is a second consumer of message events or a measured need
([ADR-0004](docs/decisions/0004-inapi-dispatcher-redpanda-deferred.md)).

## Run it locally

You need Node 22.12 or newer, Docker, and a free [Clerk](https://clerk.com) application (development keys are enough).

```bash
npm install
cp .env.example .env
```

In `.env`, set `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` from the Clerk dashboard. The other defaults work
locally.

Start Postgres, Redis and MinIO, then the migrations and the app:

```bash
docker compose -f infra/docker/compose.yml --env-file .env up -d postgres redis minio minio-init
set -a; source .env; set +a
export VITE_API_URL=http://localhost:4000
npm run migrate
npm run seed        # optional demo data
npm run dev         # api on :4000, worker, web on :5173
```

Open http://localhost:5173 and sign in with a Clerk user. GIFs, group calls, push and the AI features turn on when you
set their keys (`GIPHY_API_KEY`, `LIVEKIT_*`, `VAPID_*`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY_*`, `GEMINI_API_KEY_*`);
without them each one answers "unavailable" and the rest keeps working.

## Tests

```bash
npm run typecheck && npm run lint && npm run format:check
npm test                                  # unit tests in every package

eval "$(scripts/dev/test-deps-up.sh)"     # throwaway Postgres 17, Redis 7, MinIO
npm run test:integration
scripts/dev/test-deps-down.sh

npm run e2e                               # Playwright in real browsers (see tests/e2e/README.md)
```

`apps/api/test/integration/gate.int.test.ts` checks the delivery contract end to end: duplicate sends make one message,
concurrent sends get ordered seqs, a restart between commit and delivery loses nothing, an offline client recovers
everything, removed members get nothing, and receipts only move forward. What has been run, and what has not, is in
[`docs/status.md`](docs/status.md).

## Deploy

The demo runs on free plans: the web app on Vercel, the API and worker jobs in one Render web service, Postgres on
Supabase, Redis on Render, files in a private S3 bucket. Steps, free-plan caveats and every environment variable are in
[`docs/operations/deployment.md`](docs/operations/deployment.md).

## Limitations

- Single region, one Postgres primary, no read replicas.
- Messages are plaintext on the server (TLS plus authorisation). End-to-end encryption is deferred
  ([ADR-0011](docs/decisions/0011-e2e-encryption-deferred.md)).
- The dispatcher runs in the API process, so a slow dispatch loop uses API CPU.
- No replay log. Recovery after a long outage is sync, which reads current data.
- The demo uses Clerk **development** keys, so sign-in is limited to users created in the Clerk dashboard.
- Not verified yet: two API replicas under load, a Redis outage during traffic, real Clerk in the tests (a fake client
  is used), real Web Push delivery, and the live AI chain.

## Documentation

Everything is indexed in [`docs/README.md`](docs/README.md): architecture, features, operations, performance, security,
decision records, and the interview guide.

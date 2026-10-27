# Why this stack, and why not the alternatives

This page explains why Flick uses each technology and not the alternatives: TypeScript, React with TanStack Query and
Zustand, Fastify, Socket.IO, PostgreSQL with a transactional outbox, Redis, pg-boss, Clerk, S3-style storage, LiveKit, the
AI provider chain, Docker, Prometheus and the test tools. Each section has the same shape: what it does in Flick, why I
chose it, what I rejected, what it costs, and one line I would say in an interview. The short decision records are in
[`decisions/`](../decisions/README.md); this page puts the alternatives side by side and adds the hiring angle.

Related: [`interview-guide.md`](interview-guide.md), [`../decisions/README.md`](../decisions/README.md),
[`../architecture/overview.md`](../architecture/overview.md), [`../ai/architecture.md`](../ai/architecture.md).

**Where the market numbers come from.** The 2025 Stack Overflow Developer Survey, professional developers only:
<https://survey.stackoverflow.co/2025/technology/>. Other points come from the sources named inline. Anything marked
"estimate" is my own judgement, not a measurement. I do not use any number I could not trace.

| Technology (professional developers, 2025) | Share                 |
| ------------------------------------------ | --------------------- |
| PostgreSQL / MySQL / MongoDB               | 58.2% / 39.6% / 24.3% |
| Redis                                      | 30.7%                 |
| Docker / Kubernetes                        | 73.8% / 30.1%         |
| AWS                                        | 45.9%                 |
| Node.js / React                            | 49.1% / 46.9%         |
| Express / Fastify                          | 20.3% / 3.1%          |

A recruiter filters on keywords like these. An interviewer asks about whatever you wrote. The risk I try to avoid is
listing tools I cannot defend
(<https://www.techinterview.org/post/3233474610/side-projects-open-source-engineering-resume/>).

## TypeScript

- **What it does here:** every package (API, worker, web, database helpers) is strict TypeScript. The request,
  response and event shapes live in `packages/contracts` and are shared by the server and the client.
- **Why:** one language end to end, and the contract between client and server is checked by the compiler and by zod at
  runtime. Amazon's SDE loops accept TypeScript
  (<https://careers.uw.edu/blog/2026/01/23/amazon-software-development-engineer-2026-early-career/>).
- **Rejected:** plain JavaScript and Java/Go. Java and Go are common in Indian product company
  backends, but switching would have cost months and would not change the design.
- **Trade-off:** a build step and some type work. Types vanish at runtime, so I still validate input with zod.
- **Interview:** "The server and the client import the same event types, so a renamed field fails the build instead of
  failing in production."

## React and TanStack Query

- **What it does here:** the web client is React. TanStack Query holds server state (conversation lists, history
  pages), Zustand holds client state (connection, outbox of unsent messages). Socket.IO events update the Query cache.
- **Why:** React is the common choice (46.9% in the survey above). Splitting server state from client state keeps
  re-renders low on typing and presence. See [ADR-0013](../decisions/0013-tanstack-query-zustand.md).
- **Rejected:** Redux Toolkit (more boilerplate for the same split), context only (re-renders too much).
- **Trade-off:** two state libraries, so the border between them has to be respected.
- **Interview:** "Optimistic messages keep their `client_message_id`, so when the server acks, the cache entry is
  replaced rather than duplicated."

## Node.js and Fastify (not Express)

- **What it does here:** Fastify serves REST, hosts Socket.IO and runs the dispatcher. Routes validate input with zod
  schemas from the contracts package. See [ADR-0015](../decisions/0015-fastify.md).
- **Why:** built-in schema validation, good speed, and plugins that are encapsulated. The whole app is I/O-bound,
  which suits Node.
- **Rejected:** Express is the more common choice (20.3% against 3.1% for Fastify in the survey). Validation, typing and async errors need add-ons there. NestJS has more concepts than I want to explain.
- **Trade-off:** a smaller ecosystem and a plugin model that takes a short learning step. If a recruiter filters on
  "Express" I lose that keyword.
- **Interview:** "I know Express is the default. I picked Fastify for validation and typing, and the route code is
  almost the same, so the choice is cheap to reverse."

## Socket.IO (not raw ws, not SSE)

- **What it does here:** live delivery, typing, presence and 1:1 call signalling. Rooms per user and per device, acks on
  sends, and the Redis adapter for several API servers. See [ADR-0001](../decisions/0001-socketio-realtime.md).
- **Why:** browsers drop connections all the time. Socket.IO gives reconnect with backoff, heartbeats, rooms and acks,
  which I would otherwise write and defend myself.
- **Rejected:** raw `ws` (smaller and faster, but I would write reconnect, heartbeats, rooms, acks and a multi-server
  adapter). Server-Sent Events (one-way; typing and call signals need a second channel; fine for streaming AI text,
  and the AI routes do use SSE for that). Polling (wasteful, high latency).
- **Trade-off:** it has its own protocol, so a plain WebSocket client cannot talk to it, and rooms and acks hide some
  detail. The design does not depend on them: live events are only the fast path, and sync recovers a lost event.
- **Interview:** "WebSockets are bidirectional and low latency, and the cost is stateful connections. I used Socket.IO
  so I did not rebuild reconnect, and I made delivery correct without trusting the socket anyway."

## PostgreSQL (not MongoDB, not MySQL)

- **What it does here:** the single source of truth: users, conversations, messages, outbox, receipts cursors, jobs
  (through pg-boss) and full-text search. See [ADR-0002](../decisions/0002-postgresql-canonical-store.md) and
  [`database-schema.md`](../architecture/database-schema.md).
- **Why:** the send path needs one transaction over the message, the sequence counter and the outbox row, plus a unique
  constraint for idempotency and foreign keys. It is the most used database in the survey (58.2%).
- **Rejected:** MongoDB (24.3%) can do transactions now, but the design leans on constraints and relations, and I
  wanted that guarantee from the database itself. MySQL (39.6%) would work; I chose Postgres for `SKIP LOCKED`
  job claiming and built-in full-text search, which I use.
- **Trade-off:** one primary is the ceiling. A very hot conversation is limited by its row lock. Sharding by
  conversation is designed but not built.
- **Interview:** "Postgres, because the message, its sequence number and its outbox row must commit together, and a
  unique constraint is the idempotency guarantee."

## Transactional outbox (not dual writes, not CDC)

- **What it does here:** the send transaction inserts the message and an `outbox` row together. The dispatcher reads the
  outbox. See [ADR-0003](../decisions/0003-transactional-outbox.md).
- **Why:** it solves the dual-write problem. Writing to the database and then emitting can lose the event if the
  process dies between the two. With an outbox row, a crash leaves the work in the database to be picked up.
- **Rejected:** dual writes (lose events on a crash). CDC with Debezium (reads the write-ahead log; right at larger
  scale, but another system to run).
- **Trade-off:** duplicates are possible: a crash after the emit and before marking the row sends it again, so
  consumers must be idempotent. Flick's clients drop events by `seq`.
- **Interview:** "The outbox turns 'commit and publish' into one atomic step. The price is at-least-once, so the
  consumer has to be idempotent, and mine is."

## The in-API dispatcher (not Kafka or Redpanda, for now)

- **What it does here:** a loop inside the API claims unsent outbox rows with `FOR UPDATE SKIP LOCKED`, emits to the
  Socket.IO rooms of the current members, and marks the row done, with retry on failure. See
  [ADR-0004](../decisions/0004-inapi-dispatcher-redpanda-deferred.md).
- **Why:** there is one consumer of message events. A broker would add topics, partitions, consumer groups, offsets and
  a dead-letter path for no gain yet.
- **Rejected:** Redpanda or Kafka now. They are right when there are independent consumers, a replay need, or measured
  throughput the outbox cannot meet. I wrote those triggers down. Nothing in the app uses it.
- **Trade-off:** the dispatcher shares CPU with the API (it could move to its own process with no protocol change), and
  there is no replay log, so recovery after a long outage is sync.
- **Interview:** "I know Kafka's model (partitions, keys, consumer groups, rebalances). I did not use it, because
  with one consumer it would only add things to operate. The outbox is already my durable log, and swapping the last
  step to publish to a topic is a small change."
- **Resume:** Kafka is **not used** in the current build, so I do not claim it.

## Redis (a narrow role)

- **What it does here:** the Socket.IO adapter, presence with TTLs, shared rate limits, a token-verification cache and
  AI provider cooldowns. Nothing durable. See [ADR-0005](../decisions/0005-redis-ephemeral-only.md).
- **Why:** these are things I can lose without losing a message, and they need to be shared between API servers. Redis
  is used by 30.7% of professionals in the survey.
- **Rejected:** Redis as a queue or as a store of record (it would need persistence and backups, and I want one durable
  system), and in-memory state only (breaks with two API servers).
- **Trade-off:** if Redis goes down, cross-server live delivery pauses and presence shows offline. Messages are safe
  and sync recovers.
- **Interview:** "Redis holds only data I can rebuild. Messages live in Postgres, so a Redis outage is a latency
  problem, not a data-loss problem."

## pg-boss (not BullMQ)

- **What it does here:** background jobs: Web Push for offline users, expiring messages, upload and outbox clean-up. A
  separate worker process runs them. See [ADR-0006](../decisions/0006-pg-boss-not-bullmq.md).
- **Why:** jobs live in Postgres, which I already run, and a job can be created in the same transaction as the data.
- **Rejected:** BullMQ, which is mature and fast but needs durable Redis and cannot join a Postgres transaction. Cron
  plus SQL has no retries or delayed one-off jobs.
- **Trade-off:** lower throughput than a Redis queue, and job tables in the main database. The jobs are light.
- **Interview:** "I chose the queue that can enqueue inside the same transaction as the write, so there is no
  'row saved, job lost' case."

## Clerk (not custom auth)

- **What it does here:** sign-in. The API verifies a short-lived Clerk token and maps the Clerk id to a local `users`
  row. There are no passwords or refresh tokens in my code. See [ADR-0010](../decisions/0010-clerk-login.md) and
  [`security/auth.md`](../security/auth.md).
- **Why:** passwords, resets, social login and bot checks are easy to get subtly wrong. My API needs one answer: which
  user is this?
- **Rejected:** custom auth with refresh-token rotation (I designed it first, then dropped it as more code to defend
  than it was worth), and a hand-rolled JWT setup.
- **Trade-off:** sign-in depends on Clerk being up (verification of existing tokens uses cached keys). A disabled user
  keeps working for up to the 5-minute cache. The demo uses development keys.
- **Interview:** "I did not build auth. I verify the token, map to my own user id so my data does not depend on
  Clerk's ids, and track delivery per device."

## S3-style storage: MinIO locally (not Cloudinary)

- **What it does here:** images, files and voice notes. The browser uploads with a presigned POST and downloads with a
  short-lived presigned URL after a membership check. A job deletes abandoned uploads. See
  [ADR-0012](../decisions/0012-minio-s3-not-cloudinary.md) and [`media.md`](../features/media.md).
- **Why:** S3 is the common interface (AWS is used by 45.9% in the survey), file bytes do not pass through my API, and
  switching provider is configuration.
- **Rejected:** Cloudinary (lock-in), bytes in Postgres (bloats backups and the write-ahead log), proxying uploads
  through the API (costs bandwidth and memory).
- **Trade-off:** I run MinIO myself in development, and there is no CDN.
- **Interview:** "Presigned URLs keep large files off the API. The server still checks type, size and ownership."

## LiveKit (not mesh WebRTC)

- **What it does here:** group calls and call links. The API only issues a token; media goes to a LiveKit server.
  1:1 calls are plain peer-to-peer WebRTC with coturn as the relay. See [`calls.md`](../features/calls.md).
- **Why:** in a mesh, every participant sends a stream to every other one, so upload cost grows with the square of
  the group size. An SFU takes one stream from each person and forwards it.
- **Rejected:** mesh for groups (fine for two people, which is why 1:1 calls use it), and building my own SFU.
- **Trade-off:** one more service to run, and it needs keys. Without them the group-call endpoints answer
  `FEATURE_DISABLED` and the rest of the app is unaffected.
- **Interview:** "Two people: peer to peer. Many people: an SFU. I did not write the SFU."

## The AI provider chain

- **What it does here:** every AI feature (writing help, translation, voice transcription, image, PDF and file
  explanation, conversation understanding, the Flick assistant chat, group and productivity helpers, and the `@flick`
  bot) goes through one ordered chain: Anthropic, then two Groq accounts, then two Gemini accounts. A rate-limited
  provider gets a Redis cooldown and the next one is tried. See
  [ADR-0014](../decisions/0014-ai-provider-fallback-chain.md), [`../ai/README.md`](../ai/README.md) and
  [`../ai/feature-map.md`](../ai/feature-map.md).
- **Why:** free tiers have tight limits and outages. A chain keeps the feature usable and costs nothing when idle.
  Capability routing ([ADR-0017](../decisions/0017-multimodal-provider-routing.md)) skips providers that cannot read
  images or PDFs.
- **Guard rails:** a per-user daily quota and a per-chat privacy switch
  ([ADR-0016](../decisions/0016-ai-quota-and-privacy-guard.md)); untrusted text is fenced; nothing is logged; cheap checks
  (scam, mood, link safety) are local rules ([ADR-0023](../decisions/0023-heuristics-first-ai-optional.md)).
- **Rejected:** a single provider (unreliable), a router service (another dependency that sees the content), a local
  model (too heavy), a model call for every message (cost, latency, privacy).
- **Trade-off:** answer style differs between providers, and model names change, so the chain is configuration. With no
  keys the feature says "not configured"; it is never faked.
- **Interview:** "The AI is a feature layer, never in the delivery path. The bot replies through the normal send path,
  so the answer is stored, ordered and delivered like any message. It also needs the duplicate-delivery guard, because the
  dispatcher can emit an event twice."

## Files: presigned S3 uploads and linked-message albums

- **What it does here:** files up to 1 GB of any type go from the browser straight to S3 with a presigned POST; an album
  is N ordinary messages linked by a small metadata object.
- **Why:** the API never carries file bytes, and every delivery guarantee already built applies to each photo with no new
  schema ([ADR-0018](../decisions/0018-any-file-type-1gb-presigned-uploads.md),
  [ADR-0019](../decisions/0019-albums-as-linked-messages.md)).
- **Rejected:** an allowlist of types (easy to bypass, blocks real use), proxying uploads (memory and bandwidth), one
  message with an attachment list (one failure blocks all).
- **Trade-off:** files are stored uninspected (no virus scan), so safety depends on serving rules; uploads are not
  resumable.
- **Interview:** "Safety comes from how I serve files, not from guessing what they are."

## Markdown, tokens and the redesign

- **What it does here:** one small safe Markdown parser renders messages and AI answers ([ADR-0021](../decisions/0021-markdown-rendering-everywhere.md));
  a token-based design system with tested contrast drives light and dark themes ([ADR-0022](../decisions/0022-ui-redesign-and-serif-default.md)).
- **Rejected:** a general Markdown library plus an HTML sanitiser (bigger attack surface), keeping the glass look.
- **Interview:** "No raw HTML path exists, so there is no XSS path to review."

## Docker Compose

- **What it does here:** one command starts Postgres 17, Redis, MinIO, coturn, Prometheus, Grafana, and optionally the
  API, worker and web client. A separate compose file starts throwaway Postgres, Redis and MinIO for integration tests.
- **Why:** anyone can run it without installing the services. Docker is used by 73.8% of professionals in the survey.
- **Rejected:** Kubernetes (30.1% in the survey; far more than one or two servers need, and I would be showing
  configuration rather than design).
- **Trade-off:** compose is not a deployment platform. There is no orchestration, autoscaling or rolling update.
- **Interview:** "Compose for development and a single server. If I needed several hosts I would look at Kubernetes
  or a managed platform, and the app is stateless apart from Postgres, Redis and MinIO, so that move is mostly
  configuration."

## Prometheus and Grafana

- **What it does here:** the API and worker expose `/metrics`. Prometheus scrapes them and Grafana shows dashboards:
  connected sockets, dispatch latency, rate-limit rejections, database pool use. Alerts are in
  `infra/prometheus/alerts.yml`.
- **Why:** you can only talk about performance if you measure it, and these are the standard open tools.
- **Rejected:** a hosted vendor (cost and sign-up), and tracing with OpenTelemetry and Jaeger (dropped to keep the
  stack small).
- **Trade-off:** I have checked that metric names match the code, but not the dashboards against a running Prometheus.
- **Interview:** "I would page on the oldest unsent outbox row, p99 dispatch latency, and database pool exhaustion."

## Vitest, Playwright and k6

- **What they do here:** Vitest runs unit and integration tests; integration tests use real Postgres, Redis and MinIO.
  The gate tests check the delivery contract (duplicate sends, concurrent ordering, restart, offline recovery, removed
  members, receipts). Playwright browser journeys live in `tests/e2e/`. The k6 runner (`npm run load`) has no scenarios yet, so nothing
  is claimed for load tests.
- **Why:** a few tests that prove the behaviours an interviewer asks about are worth more than many permutations. Real
  databases catch what mocks hide, such as lock behaviour and constraint conflicts.
- **Rejected:** mocking Postgres (it would not test the row lock or `SKIP LOCKED`), and Jest (Vitest is faster with
  this ESM and TypeScript setup).
- **Trade-off:** integration tests need Docker and run one file after another, because they share one Redis.
- **Interview:** "The gate test sends from eight clients at once and asserts the sequence is 1 to 80 with no gaps. I
  will quote load-test numbers only after I have run them."

## Resume wording

Lead with the keyword a recruiter searches for, and put the specific tool in brackets. Only write what the build
actually does.

| Lead with (keyword)           | Specific tool, in brackets | Status in the current build                                  |
| ----------------------------- | -------------------------- | ------------------------------------------------------------ |
| Node.js + TypeScript REST API | (Fastify)                  | Used. Know why not Express                                   |
| WebSockets (real-time)        | (Socket.IO, Redis adapter) | Used                                                         |
| PostgreSQL                    | (transactional outbox)     | Used                                                         |
| Amazon S3-compatible storage  | (MinIO locally)            | Used. Presigned URLs                                         |
| Redis                         | (presence, rate limits)    | Used, ephemeral only                                         |
| Postgres-backed job queue     | (pg-boss)                  | Used                                                         |
| Authentication                | (Clerk)                    | Used. Development keys on the demo                           |
| LLM integration               | (provider fallback chain, quotas, privacy switch) | Used. Know the failure handling per error type |
| Presigned uploads             | (S3, safe serving)         | Used. Not virus scanned, not resumable                       |
| Docker                        | (Compose)                  | Used                                                         |
| Prometheus and Grafana        | -                          | Used; dashboards not checked against a live Prometheus       |
| Kafka                         | (Redpanda)                 | **NOT used in the current build. Do not claim it.** Deferred |
| End-to-end encryption         | (Signal protocol)          | **NOT built.** Deferred                                      |

Whatever goes on the resume, the topics worth being able to whiteboard are the outbox with at-least-once delivery,
per-conversation ordering, idempotency, and how a client recovers after a disconnect. When I have measured numbers
from k6 and Prometheus, they go next to those claims, and not before.

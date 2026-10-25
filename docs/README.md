# Flick documentation

Start with the [architecture overview](architecture/overview.md), then the
[delivery guarantees](architecture/delivery-guarantees.md). The project front page is the [root README](../README.md).

## Architecture

- [`architecture/overview.md`](architecture/overview.md): folders, packages, the gateway, dispatcher and worker, how to run and test.
- [`testing.md`](testing.md): how to run each test suite, what each one proves, coverage numbers, failure-injection results.
- [`architecture/system-design.md`](architecture/system-design.md): components, sequences, failure boundaries, scaling.
- [`architecture/delivery-guarantees.md`](architecture/delivery-guarantees.md): the contract for sending, ordering, receipts, sync.
- [`architecture/protocol.md`](architecture/protocol.md): Socket.IO events and payloads.
- [`architecture/database-schema.md`](architecture/database-schema.md): tables, indexes and the outbox.
- [`architecture/sharding-multi-region.md`](architecture/sharding-multi-region.md): a future design, not built.

## Features

- [`features/ai.md`](features/ai.md): the AI assistant, provider fallback and the @flick bot.
- [`features/calls.md`](features/calls.md): 1:1 and group calls, call links, and the web client.
- [`features/media.md`](features/media.md): uploads, downloads, GIFs, link previews.
- [`features/profile.md`](features/profile.md): how a name flows between Flick, other people's screens and the sign-in account.
- [`features/message-gestures.md`](features/message-gestures.md): swipe to reply, double tap to heart, choosing several messages.
- [`features/pwa-and-push.md`](features/pwa-and-push.md): the installable app and Web Push.
- [`features/calls-offline.md`](features/calls-offline.md): calls that reach people who are offline or have the app closed, and the limits.
- [`features/guide.md`](features/guide.md): the in-app tour and tips, the rules that keep them polite, and how to add a topic.

## Operations

- [`operations/deployment.md`](operations/deployment.md): Vercel, Render, Supabase, S3 and Clerk on free plans.
- [`operations/runbook.md`](operations/runbook.md): running with Docker, health checks, common problems, backups.

## Performance and security

- [`performance/database.md`](performance/database.md): database benchmarks, with query plans in [`performance/query-plans/`](performance/query-plans/).
- [`security/auth.md`](security/auth.md): Clerk login, devices and rate limits.

## Decisions and status

- [`decisions/`](decisions/README.md): one short record per design choice.
- [`status.md`](status.md): what has been verified, and what has not.

## Interview

- [`interview/interview-guide.md`](interview/interview-guide.md): questions, answers, and what not to claim.
- [`interview/stack-rationale.md`](interview/stack-rationale.md): why this stack and not the alternatives.

Screenshots used in the README are in [`screenshots/`](screenshots/).

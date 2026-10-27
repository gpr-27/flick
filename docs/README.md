# Flick documentation

Flick is a real-time chat app with an AI layer. Messages are saved in PostgreSQL in one transaction with an outbox row, a
dispatcher turns the outbox into live Socket.IO events, and clients repair any gap by syncing, so nothing is lost,
duplicated or reordered. On top of that core it has groups, rich messages (albums, any file up to 1 GB, Markdown, polls,
cards), calls, push notifications, productivity tools, and AI that is used in many places but only runs when the user asks.
This page is the front page of the docs: what Flick is, how to start, where to find what, the feature highlights and the
current status.

Related: [root README](../README.md), [`architecture/overview.md`](architecture/overview.md), [`features/README.md`](features/README.md),
[`ai/README.md`](ai/README.md), [`status.md`](status.md), [`changelog.md`](changelog.md).

## Quick start

```bash
npm install
cp .env.example .env            # set CLERK_SECRET_KEY and VITE_CLERK_PUBLISHABLE_KEY
docker compose -f infra/docker/compose.yml --env-file .env up -d postgres redis minio minio-init
set -a; source .env; set +a; export VITE_API_URL=http://localhost:4000
npm run migrate && npm run seed
npm run dev                      # api :4000, worker, web :5173
```

Full steps and the list of optional keys are in the [root README](../README.md); hosting is in
[`operations/deployment.md`](operations/deployment.md).

## Suggested reading order

1. [`architecture/overview.md`](architecture/overview.md): folders, packages, gateway, dispatcher, worker, where AI fits.
2. [`architecture/delivery-guarantees.md`](architecture/delivery-guarantees.md): the contract for sending, ordering, receipts, sync.
3. [`features/README.md`](features/README.md): every feature, with links to the details.
4. [`ai/README.md`](ai/README.md) and [`ai/feature-map.md`](ai/feature-map.md): all the places AI is used.
5. [`operations/deployment.md`](operations/deployment.md) and [`status.md`](status.md).

## Where to find what

| Folder or file | What is in it |
| -------------- | ------------- |
| [`architecture/`](architecture/overview.md) | [overview](architecture/overview.md), [system design](architecture/system-design.md), [delivery guarantees](architecture/delivery-guarantees.md), [protocol](architecture/protocol.md) (all 189 REST endpoints and the Socket.IO events), [database schema](architecture/database-schema.md) (every table and migration 0001-0034), [sharding (future)](architecture/sharding-multi-region.md) |
| [`features/`](features/README.md) | One page per feature area: [messaging](features/messaging.md), [rich messages](features/rich-messages.md), [media and files](features/media-and-files.md), [groups](features/groups.md), [calls](features/calls.md), [notifications](features/notifications.md), [chat list](features/chat-list.md), [search and organise](features/search-and-organise.md), [calendar and productivity](features/calendar-and-productivity.md), [settings](features/settings.md), [appearance and accessibility](features/appearance-and-accessibility.md), [safety and privacy](features/safety-and-privacy.md), [integrations](features/integrations.md), [profile](features/profile.md), [PWA and push](features/pwa-and-push.md), [reminders](features/reminders.md), [guide](features/guide.md), [message gestures](features/message-gestures.md) |
| [`ai/`](ai/README.md) | [architecture](ai/architecture.md), [privacy and limits](ai/privacy-and-limits.md), [writing assistant](ai/writing-assistant.md), [Flick assistant](ai/flick-assistant.md), [conversation understanding](ai/conversation-understanding.md), [files, images and voice](ai/files-images-voice.md), [translation and transcription](ai/translation-and-transcription.md), [productivity and safety](ai/productivity-and-safety.md), [feature map](ai/feature-map.md) |
| [`decisions/`](decisions/README.md) | 26 short decision records (ADR-0001 to 0026) |
| [`security/`](security/auth.md) | [login, devices, secrets, upload safety](security/auth.md), [threat model](security/threat-model.md) |
| [`operations/`](operations/deployment.md) | [deployment](operations/deployment.md) (Vercel, Render, Supabase, S3, Clerk, env vars), [runbook](operations/runbook.md); [platform setup](platform-setup.md) for external services |
| [`performance/`](performance/database.md) | Database benchmarks, with query plans in [`performance/query-plans/`](performance/query-plans/) |
| [`design/`](design/design-system.md) | [design system](design/design-system.md) (implemented) and the original [redesign spec](design/ui-redesign-spec.md) |
| [`testing.md`](testing.md) | How to run every suite, current counts, conformance test, failure injection |
| [`status.md`](status.md) | What is built, partial, missing, known issues |
| [`audit/missing-features.md`](audit/missing-features.md) | Known gaps and the idea backlog |
| [`changelog.md`](changelog.md) | What was added, by area |
| [`interview/`](interview/interview-guide.md) | [Interview guide](interview/interview-guide.md) and [stack rationale](interview/stack-rationale.md) |
| [`screenshots/`](screenshots/) | Images used in the README |

## Feature highlights

- **Delivery you can trust:** idempotent sends, per-conversation order, delivered and read cursors, offline sync.
- **Rich messages:** albums, files up to 1 GB served safely, voice notes with transcripts, polls, checklists, expense
  splits, games, shared events, Markdown, view-once and disappearing messages.
- **Groups:** roles, invites, join requests, slow mode, welcome text, flagged list, analytics, webhooks.
- **Calls:** 1:1 and group calls, call links, ringing for offline users.
- **Productivity:** scheduled messages, reminders, bookmarks, folders and tags, calendar, daily digest, email-to-chat.
- **AI, in many places:** writing help and tone, translation, transcription, image and file explanation, conversation
  understanding, the Flick assistant with memory, group and productivity helpers. Always on request, with a per-chat
  privacy switch, a daily quota and a fallback chain of providers. Local rules handle scam and safety checks without AI.
  See [`ai/feature-map.md`](ai/feature-map.md).
- **Look:** a calm solid-surface design with light and dark themes, a serif default, wallpapers and a phone tab bar. The phone Back button and back swipe close overlays one by one.

## Status

Built and tested: the whole delivery pipeline and every feature above (web about 2,170 tests, API about 1,800 integration
tests). One known failing test (chat-list query plan). Needs external setup: Clerk paths and keys, AI keys, S3, VAPID,
LiveKit/TURN. Not built: end-to-end encryption, Kafka, sharding, hands-free voice lock, background blur, AI analysis of video. Details: [`status.md`](status.md) and [`audit/missing-features.md`](audit/missing-features.md).

# Status

This page is an honest, current picture of Flick: what is built, what is partly built, what is not built, what is known to
be wrong, and what needs setup outside the repo before it works. It is written from the code in the repository at the
time of the second documentation pass (2026-10-27). A statement here that says "verified" means a test or command was run for
it and the source of that is named; otherwise it is "built" (code and tests exist) or "not verified".

Related: [`testing.md`](testing.md), [`audit/missing-features.md`](audit/missing-features.md), [`platform-setup.md`](platform-setup.md),
[`changelog.md`](changelog.md), [`ai/README.md`](ai/README.md), [`features/README.md`](features/README.md).

## Summary

| Area              | State                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery pipeline | Built and tested: gate tests (duplicates, order, restart, offline recovery, removed members, monotonic receipts)                                                            |
| Chat features     | Built: see [`features/README.md`](features/README.md) (groups, rich messages, albums, any file to 1 GB, calls, push, PWA, productivity, group tools, phone Back navigation) |
| AI                | Built, used in many places, always on request: see [`ai/README.md`](ai/README.md) and [`ai/feature-map.md`](ai/feature-map.md). Needs provider keys                         |
| Web app           | Built; redesigned (solid surfaces, serif default, mobile tab bar); about 2,170 unit tests                                                                                   |
| Database          | 34 migration files (0001 to 0034, gaps at 0014, 0021, 0026, 0030), about 50 tables                                                                                          |
| REST contract     | 189 endpoints, one conformance scenario each                                                                                                                                |
| Deployment        | Vercel (`flick-app`) and Render (`flick-server`, auto-deploys `main`, runs `migrate:prod` on start); free plans                                                             |

## Tests (rounded; details in testing.md)

| Suite            | Count         | Result                                                                                          |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Web              | about 2,170   | passing                                                                                         |
| API unit         | about 180     | passing                                                                                         |
| API integration  | about 1,800   | passing                                                                                         |
| Contracts        | about 45      | passing                                                                                         |
| Database         | 56            | one known failure: chat-list `EXPLAIN` plan test in `packages/database/test/pagination.test.ts` |
| AI               | about 38      | passing                                                                                         |
| Browser journeys | 27 spec files | not re-run for this page                                                                        |

## Built

- **Core delivery:** transactional outbox, per-conversation `seq`, idempotent sends, in-API dispatcher, receipts as
  cursors, sync, presence, typing. Gate run on 2026-10-24 against throwaway Postgres 17, Redis 7 and MinIO; failure
  injection (Redis outage, killed Postgres connection, two dispatchers) is described in [`testing.md`](testing.md).
- **Messaging:** direct chats, groups with roles, invite links and join requests, edit with history, delete, reactions,
  replies, forward, mentions, pins, stars, private notes, drafts across devices, scheduled messages, reminders, polls,
  disappearing and view-once messages, Saved messages, folders and tags, message search including voice transcripts.
- **Content:** images, video, albums (up to 20 items, 2 GiB per send, one alert for the whole album), a full-screen media viewer, PDF preview, any file up to 1 GB with safe serving, voice notes with waveform,
  GIFs and stickers, link previews, Markdown everywhere, checklists, expense splits, small games, shared Events with RSVP.
- **Calls:** 1:1 WebRTC calls with TURN, group calls and call links through LiveKit, ringing for offline users, call log.
- **Notifications:** Web Push, notification centre, quiet hours, digest, installable PWA with an offline outbox.
- **AI:** writing help and tone, translation and auto-translate, voice transcription, image/PDF/document explanation,
  conversation understanding, the Flick assistant chat with memories and topics, group and productivity helpers, daily
  quota and a per-chat privacy switch that is enforced on every AI path, including background jobs. A finished Flick topic can be resumed. Safety, scam and mood checks run locally.
- **Phone behaviour:** Back button and back swipe close overlays one by one, edge swipe back, double Back to exit in the installed app ([ADR-0024](decisions/0024-phone-back-navigation-and-gestures.md)).
- **Look:** serif default, solid surfaces, global and per-chat wallpapers, uploaded wallpapers kept on the device, Markdown everywhere.
- **Account and safety:** Clerk sign-in inside Flick (dashboard paths set, username optional), devices list and revoke, new-device alerts, passkeys (enabled),
  privacy settings, block and report, data export, account delete, incoming webhooks and email-to-chat (the address is shown in Settings, Account when the operator sets it up).
- **Operations:** Docker compose stacks, Prometheus and Grafana, health endpoints, Render and Vercel configuration.

## Partly built

| Item                   | What works                                                           | What is missing                                                                     |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Notification Reply box | Opens the chat with the typed text as a draft                        | A real send from the notification                                                   |
| Voice notes            | Record, waveform, transcribe                                         | Hands-free lock                                                                     |
| Group slow mode        | Enforced by the server                                               | A countdown in the composer                                                         |
| Group flagged list     | Admins see flagged messages                                          | One-step mute for the sender                                                        |
| AI streaming           | Header Ask Flick and Summarize stream                                | Bot replies and most other tasks return the whole answer at once                    |
| Back navigation        | 18 overlay components, edge swipe, double Back to exit               | Call overlays and the guide tour are not wired to Back; iOS keyboard handling       |
| Wallpapers             | Per-chat and global, uploads from the gallery                        | The global wallpaper and uploaded images are not synced across devices              |
| Audio transcripts      | Voice notes have a transcript button; the server accepts audio files | No transcript button found on audio sent as a plain file (not checked in a browser) |
| Keyword alerts         | Break through mute while Flick is open                               | Nothing when the app is closed                                                      |
| AI data export         | Memories, topics, ratings, styles, transcripts you caused, settings  | The server-side translation cache is not in the export                              |
| Albums                 | Photos and videos group into one grid                                | "Send as files" sends separate messages that are not grouped                        |
| Avatars                | Clerk picture; uploads                                               | With a private bucket and no `S3_PUBLIC_URL` only the Clerk picture is shown        |

## Not built

See [`audit/missing-features.md`](audit/missing-features.md) for the list with notes: hands-free voice lock, background
blur in calls, streaming of bot replies, birthdays, mute for flagged senders, composer slow-mode countdown, share target
for files, real reply from a push notification, AI analysis of video (and transcription of video, see
[ADR-0025](decisions/0025-videos-are-not-transcribed.md)), a per-task AI speed preference for the older `packages/ai`
tasks, a global wallpaper that follows you to another device, Back for call overlays and the guide tour, iOS keyboard
handling. Also not built by design: end-to-end encryption, Kafka/Redpanda, sharding and multi-region, load tests (k6),
tracing.

## Known issues

- **Failing test:** the chat-list `EXPLAIN` test in `packages/database/test/pagination.test.ts` fails (known, existed
  before the latest work; cause not investigated here).
- `publishOutboxBatch` and `markEventProcessed` in `@chat/db` are not used by the apps; they are kept for the day a
  broker is added.
- The `audit_log` table exists and nothing writes it. `users.is_demo` exists and nothing sets it.
- `messages_delivered_total` counts a message as delivered when the recipient had a socket at emit time, not when the
  client acked.
- Free-plan hosting: the Render service sleeps after 15 minutes without traffic (sockets drop, next request takes about a
  minute); Supabase free projects pause after a week of inactivity; Clerk development keys show a banner.
- The AI daily quota fails open if Redis is unreachable.
- Messages are plaintext on the server ([ADR-0011](decisions/0011-e2e-encryption-deferred.md)).
- Chat lock is a convenience in the browser, not security.

## Needs external setup

Clerk (keys, paths, passkeys), AI provider keys, Groq key for transcription, S3 bucket and CORS, VAPID keys for push,
LiveKit and TURN for calls, GIPHY key, an inbound email provider for email-to-chat. Steps and variables:
[`platform-setup.md`](platform-setup.md) and [`operations/deployment.md`](operations/deployment.md).

## Not verified

Two API replicas under sustained load; a Redis outage during heavy traffic; real Clerk in automated tests (a fake client
is used); real Web Push delivery to a push service; the live AI chain against all providers at once; real GIPHY and
link-preview fetches; Grafana dashboards in a running Grafana; the full Docker production stack. These were not run for
this documentation pass.

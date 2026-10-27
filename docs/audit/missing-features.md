# Known gaps and ideas

This page lists what Flick does **not** do yet, so nobody has to guess. It replaces the older audit that listed features
such as invite-link UI, profile editing, message info, reduced motion and notification settings as missing: all of those
now exist. Only things that are truly absent today are listed here, followed by an idea backlog that is not planned work.
Tags: effort S (under a day), M (a few days), L (a week or more).

Related: [`../status.md`](../status.md), [`../features/README.md`](../features/README.md), [`../ai/feature-map.md`](../ai/feature-map.md),
[`../changelog.md`](../changelog.md), [`../decisions/README.md`](../decisions/README.md).

## Known gaps

| Gap                                   | What is missing                                                                                                                                                  | Why it is not there / notes                                                  | Effort |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Hands-free voice lock                 | Voice notes can be recorded and sent, but there is no "slide up to lock and keep recording hands-free" gesture                                                   | Needs a pointer gesture state machine that works on iOS and Android browsers | M      |
| Background blur in calls              | No blurred or replaced background for video calls                                                                                                                | Needs a segmentation model in the browser; heavy on cheap phones             | L      |
| Streaming of bot replies              | The header Ask Flick and Summarize stream; replies from the @flick bot and most other AI results arrive whole                                                    | Simpler to cache and fence; streaming per task would need UI work            | M      |
| Birthdays                             | No birthday field, reminder or greeting                                                                                                                          | Needs a profile field with a privacy setting                                 | S      |
| Mute for flagged senders              | A group admin can see flagged messages but cannot mute the sender from that list in one step                                                                     | Needs a per-member mute state in group tools                                 | M      |
| Composer slow-mode countdown          | When a group has slow mode the server refuses an early send (`SLOW_MODE` with `wait_seconds`), but the composer shows no countdown                               | UI only; the server already returns the wait                                 | S      |
| Share-target for files                | The installed app can receive shared text and links but not shared files from the system share sheet                                                             | Needs a service-worker POST handler that stores the file and opens a chat    | M      |
| Real reply from a push notification   | The Reply box on a notification (Chrome and Edge desktop) opens the chat with the text as a draft; the worker does not send it                                   | A safe send from the service worker needs a short-lived credential           | M      |
| AI analysis of video                  | AI can explain images, PDFs, documents and voice notes, not video. Videos are also not transcribed ([ADR-0025](../decisions/0025-videos-are-not-transcribed.md)) | Needs audio extraction (Whisper takes 25 MB) or frame extraction             | L      |
| Per-task AI speed preference          | There is one speed setting (fast or quality) for all AI tasks; the older `packages/ai` tasks do not take a per-task choice                                       | A map of task to preference, plus UI                                         | S      |
| Global wallpaper on other devices     | The global wallpaper and uploaded wallpaper pictures live on one device ([ADR-0026](../decisions/0026-global-and-per-chat-wallpaper-precedence.md))              | Needs a server copy of the setting and the pictures                          | M      |
| Back for call overlays and guide      | Call screens and the guide tour do not close with the phone Back button ([ADR-0024](../decisions/0024-phone-back-navigation-and-gestures.md))                    | Wire them to `useBackClose`; calls need care so Back does not hang up        | S      |
| iOS keyboard handling                 | No special handling of the on-screen keyboard on iOS (layout may jump)                                                                                           | Needs visual viewport work and testing on real iPhones                       | M      |
| Transcript button on audio files      | Voice notes show a transcript button; I found none on audio sent as a plain file, although the server accepts audio files                                        | Not checked in a browser                                                     | S      |
| Keyword alerts when the app is closed | Keyword alerts work only while Flick is open                                                                                                                     | The server would have to check keywords before sending a push                | M      |
| Translation cache in AI data export   | The server-side translation cache is not in the "Download my AI data" file and is not cleared by "Clear my AI data"                                              | Register an exporter and a cleaner for it                                    | S      |
| Albums sent as files                  | "Send as files" sends separate messages that are not grouped as an album                                                                                         | Needs an `album` field on file content                                       | M      |

## Limits that are by design

- Messages are not end-to-end encrypted ([ADR-0011](../decisions/0011-e2e-encryption-deferred.md)).
- One region and one Postgres primary; no sharding ([`../architecture/sharding-multi-region.md`](../architecture/sharding-multi-region.md)).
- No Kafka or Redpanda; the dispatcher runs inside the API ([ADR-0004](../decisions/0004-inapi-dispatcher-redpanda-deferred.md)).
- Chat lock is a browser-side convenience, not server security.
- Files are not virus scanned and uploads are not resumable.
- No load tests: `npm run load` expects scenarios that were never written.
- No tracing (OpenTelemetry); logs and metrics only.

## Idea backlog (not planned)

Ideas worth a look when there is time. None of these is started.

- Broadcast lists (send one message to many chats), and status or stories.
- Sticker packs (today: GIFs and a sticker picker only).
- Resumable uploads for very large files, and optional virus scanning on upload completion.
- Message translation shown inline by default per language pair across all chats.
- Pinned chat summaries refreshed when the chat grows.
- Admin tools: audit log writes (the `audit_log` table exists and nothing writes it), moderator roles beyond admin.
- A public status page and uptime alerts for the hosted demo.
- Passkey-only sign-in flow and a "sign in with QR" from a phone.
- Load tests (k6) and a two-replica soak test with Redis outage injection.
- Search filters (by sender, date, type) and search inside AI memories.
- Read-only share links for a chat export.
- Message reminders from the lock screen (action button on the reminder push).

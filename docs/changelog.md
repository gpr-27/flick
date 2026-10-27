# Changelog

This is a release-style list of what was added to Flick since commit `37868c4`, grouped by area. It was assembled from the
code, the migrations (0018 to 0034) and the docs, not from a commit-by-commit diff, because git history could not be read
while writing it; check `git log 37868c4..HEAD` for the exact commits. Each item says what a person or developer notices.

Related: [`status.md`](status.md), [`features/README.md`](features/README.md), [`ai/feature-map.md`](ai/feature-map.md),
[`decisions/README.md`](decisions/README.md), [`architecture/database-schema.md`](architecture/database-schema.md).

## Database (migrations 0018 to 0034)

Numbers 0021, 0026 and 0030 do not exist (nor 0014); see [`architecture/database-schema.md`](architecture/database-schema.md).

| Migration                | Added                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0018 long_text           | Text up to 65,000 characters, also for scheduled messages                                                                                             |
| 0019 message_notes_edits | `message_edits` (edit history), `message_notes` (private notes)                                                                                       |
| 0020 conversation_drafts | Drafts that follow you across devices                                                                                                                 |
| 0022 chat_lists          | Folders and coloured tags                                                                                                                             |
| 0023 ai_privacy          | "Allow Flick to read this chat" per chat                                                                                                              |
| 0024 flick_assistant     | Memories, topics and feedback for the Flick assistant                                                                                                 |
| 0025 productivity        | Tags on saved messages, bookmark collections and bookmarks, digest and quiet-hours settings                                                           |
| 0027 group_tools         | Slow mode, welcome text, and message types `checklist`, `expense`, `game`                                                                             |
| 0028 writing             | Writing style profile and per-chat style                                                                                                              |
| 0029 transcripts         | Voice transcripts (searchable), auto-translate and auto-transcribe settings                                                                           |
| 0031 platform            | Incoming webhooks (hashed tokens), new-device alert switch                                                                                            |
| 0032 events              | Shared Event cards (`event` type) and RSVPs                                                                                                           |
| 0033 topic_resume        | `ai_topics.resumes_topic_id` (null, references `ai_topics`, `ON DELETE SET NULL`): resume a finished Flick topic                                      |
| 0034 transcript_author   | `message_transcripts.author_id` (null, references `users`, `ON DELETE SET NULL`): who asked for a transcript, so AI data export and erase can find it |

## AI

- AI is now used in many places, always on request: writing help and tone check, "write this with Flick", reply
  suggestions, summaries, catch-up cards, translation (one text, a batch, auto-translate per chat, a "don't translate"
  list), voice-note transcription with editable transcripts, explaining images, PDFs, documents and spreadsheets,
  conversation understanding (intent, "why did Flick say this"), action items, plans, poll drafts, flashcards, dictation,
  group helpers (mood, icebreaker, itinerary, flagging) and productivity helpers (ask Saved messages, meeting notes,
  reminder extraction, link check). See [`ai/README.md`](ai/README.md) and [`ai/feature-map.md`](ai/feature-map.md).
- The Flick assistant: a direct chat that answers every message, with memories you can edit or clear, topics (fresh
  contexts), thumbs feedback and follow-up suggestions; `@flick` still works in groups (limits: 5 per user and 10 per chat
  per minute in groups).
- Multimodal routing: requests with images or PDFs go only to providers that can read them
  ([ADR-0017](decisions/0017-multimodal-provider-routing.md)).
- Daily quota per user (`AI_DAILY_LIMIT`, default 200 per UTC day, shown in Settings), per-minute limit, and a per-chat
  privacy switch ([ADR-0016](decisions/0016-ai-quota-and-privacy-guard.md)).
- Per-attempt and total timeouts for the provider chain (`AI_ATTEMPT_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`).
- Heuristics first: scam, link, impersonation, mood and promise detection and folder suggestions run locally
  ([ADR-0023](decisions/0023-heuristics-first-ai-optional.md)).
- Untrusted-text fencing for chat text, files and fetched pages; AI export and erase (`/ai/data`).

## Messaging and content

- **Albums:** pick up to 20 photos and videos and send them as one album (linked ordinary messages,
  [ADR-0019](decisions/0019-albums-as-linked-messages.md)).
- **Any file type up to 1 GB** with presigned uploads and safe serving: inline only for images, audio and video; PDFs
  through a preview link; everything else downloads ([ADR-0018](decisions/0018-any-file-type-1gb-presigned-uploads.md)).
  The upload limit was 100 MiB before; text limit 16,000 to 65,000 characters; one frame up to 1 MiB.
- **Markdown everywhere** with one safe renderer, and a formatting toolbar ([ADR-0021](decisions/0021-markdown-rendering-everywhere.md)).
- Edit history, private notes on messages, cross-device drafts, scheduled messages, reminders, Saved messages,
  bookmarks and collections, tags on saved messages.
- Cards: checklists, expense splits, small games (tic-tac-toe), shared Events with RSVP and a calendar page.
- Photo editor, camera capture, document preview (PDF), media lightbox and gallery, GIF picker and sticker handling.
- Chat list: delete or clear a chat for yourself, mark as unread, folders and tags, a suggested folder from the chat name.
- Search finds words spoken in voice notes (transcripts).

## Groups and platform

- Slow mode (the server returns `SLOW_MODE` with `wait_seconds`), welcome text, flagged messages list, group analytics.
- Incoming webhooks (`POST /hooks/:id/:token`), email-to-chat (`POST /inbound/email`), storage usage per chat,
  "Your week in Flick" stats.
- New-device sign-in alerts, passkeys card (when enabled in Clerk), hidden chats vault, keyword alerts, live captions,
  read aloud, offline cache of recent chats.

## Sign-in and profile

- Clerk sign-in and sign-up now live at `/sign-in` and `/sign-up` inside Flick with `afterSignOutUrl="/"`; username is
  optional; the profile is Flick's and is pushed to Clerk ([ADR-0020](decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md)).
- `CORS_ORIGINS` also acts as Clerk `authorizedParties`.

## Design and accessibility

- UI redesign: solid surfaces, tokens, light and dark themes, six accents, contrast tests, a mobile tab bar, hover styles
  only with a pointer, portaled menus with collision handling, serif default font
  ([ADR-0022](decisions/0022-ui-redesign-and-serif-default.md), [`design/design-system.md`](design/design-system.md)).
- Font, size, density, corner, reduce-motion, dyslexia-friendly and high-contrast settings.
- Fixes for stuck hover highlights on phones, clipped menus under blurred headers, and low-contrast meta text.

## Calls and notifications

- Calls to people who are offline (call push with a one-time token to decline from the notification), call log, missed
  call badge, notification centre with kinds `message`, `mention`, `reply`, `reminder`, `missed_call`, quiet hours and
  priority contacts, daily or weekly digest, push troubleshooting fields (`last_status`, `last_success_at`).

## API and contracts

- The contract list grew to 189 REST endpoints (users, conversations, messages, media, calls, scheduled, chat lists,
  group tools, notes, drafts, productivity, reminders, AI, Flick, push, notifications, moderation, platform). A conformance
  test calls each one ([`testing.md`](testing.md)).
- New error codes `SLOW_MODE`, `AI_UNAVAILABLE`; `FEATURE_DISABLED` for unconfigured GIPHY and LiveKit.

## Operations

- Render service `flick-server` auto-deploys `main` and runs `npm run migrate:prod` before the server starts; Vercel
  `flick-app` builds `apps/web` with security headers including `Permissions-Policy: camera=(self), microphone=(self),
geolocation=(self)` ([`operations/deployment.md`](operations/deployment.md)).
- New environment variables: `AI_DAILY_LIMIT`, `AI_ATTEMPT_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`, `GROQ_API_KEY_1/2`,
  `GEMINI_API_KEY_1/2`, `INBOUND_EMAIL_SECRET`, `INBOUND_EMAIL_DOMAIN`.
- Test counts: web about 2,170, API unit about 180, API integration about 1,800, contracts about 45, database 56, AI about 38.

## Second batch (after the first documentation pass)

- **Albums landed in full:** up to 20 photos and videos, 2 GiB per send, 3 uploads at a time, caption on the first
  item, `album.videos` for "3 photos and 2 videos", one notification for the whole album, and a confirm before leaving
  while an upload is in flight ([ADR-0019](decisions/0019-albums-as-linked-messages.md)).
- **Media viewer:** full-screen viewer for photos and videos with swipe between items.
- **PDF preview:** `GET /media/:id/url?preview=1` shows a verified PDF in the browser; no other type is ever shown inline
  ([ADR-0018](decisions/0018-any-file-type-1gb-presigned-uploads.md)).
- **Back navigation:** phone Back and back swipe close overlays one at a time, edge swipe back, double Back to exit in
  the installed app, with an exception for iOS Safari tabs ([ADR-0024](decisions/0024-phone-back-navigation-and-gestures.md)).
- **Topic resume:** `POST /flick/topics/:id/resume` continues a finished Flick topic (migration 0033).
- **Translation fixes:** translate and translate-batch take `conversation_id`, so the privacy switch applies and cache
  entries are scoped to the chat.
- **Privacy and quota enforcement:** the per-chat AI switch is now enforced on writing-style samples, Whisper,
  translate routes and background jobs; the quota counts transcribe, translate-batch and auto-transcribe; AI data export
  and erase cover every module through a registry, including transcripts a person caused (migration 0034)
  ([ADR-0016](decisions/0016-ai-quota-and-privacy-guard.md)).
- **Markdown rendering:** one safe renderer in bubbles, previews, AI answers and notes.
- **Wallpapers:** a global wallpaper beside the per-chat one (per-chat wins), pictures from the gallery kept on the
  device ([ADR-0026](decisions/0026-global-and-per-chat-wallpaper-precedence.md)).
- **Tic-tac-toe solo:** in a chat with yourself you play both sides.
- **Look:** serif is the default font again; sent and received bubble and link colours were set with measured contrast;
  hover styles apply only with a pointer; menus are portaled with collision handling
  ([`design/design-system.md`](design/design-system.md)).
- **Videos are not transcribed** (audio and voice notes only; [ADR-0025](decisions/0025-videos-are-not-transcribed.md)).
- **Clerk set up:** sign-in `/sign-in`, sign-up `/sign-up`, home `/`, after sign-out `/` set in the dashboard; username
  optional; passkeys enabled.
- **Cleanup pass:** priority contacts are copied to the server's quiet hours, the email-to-chat address is shown in
  Settings, Account (`GET /platform/email-alias`, needs `INBOUND_EMAIL_SECRET` and `INBOUND_EMAIL_DOMAIN`), a Calendar
  entry in the laptop menu, and dead code removed.
- Contract list is now 189 endpoints.

## Known issues at this point

- One failing query-plan test for the chat list in `packages/database/test/pagination.test.ts`.
- See [`audit/missing-features.md`](audit/missing-features.md) for the open gaps.

## Documentation

- The docs were rewritten: new `docs/ai/` and `docs/features/` sets, ADRs 0016 to 0026, a threat model, a design system
  page, a complete protocol (all endpoints) and database schema (all migrations), and honest status and gap pages.

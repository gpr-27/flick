# Flick web client (`@chat/web`)

The Flick web app: a React 18 + TypeScript (strict) single page app built with Vite, styled with Tailwind and daisyUI
tokens, installable as a PWA. It holds all client state in Zustand stores, talks to the API through the typed contracts in
`@chat/contracts` (REST) and Socket.IO (real time), keeps an offline outbox in IndexedDB, and runs local safety checks.
This page explains the folders, state, delivery behaviour, routes, environment, scripts and test setup of the client.

Related: [`../../docs/README.md`](../../docs/README.md), [`../../docs/design/design-system.md`](../../docs/design/design-system.md),
[`../../docs/features/README.md`](../../docs/features/README.md), [`../../docs/ai/README.md`](../../docs/ai/README.md),
[`../../docs/testing.md`](../../docs/testing.md), [`../../docs/features/pwa-and-push.md`](../../docs/features/pwa-and-push.md).

**Stack.** React 18, React Router 6, Zustand 5, TanStack Virtual, Clerk (`@clerk/clerk-react`), Socket.IO client, LiveKit
client, Tailwind 3 + daisyUI 4, `vite-plugin-pwa`, Vitest + Testing Library (about 2,170 tests).

**Routes** (`src/app/App.tsx`): `/` chats, `/profile`, `/people`, `/u/:username`, `/calls`, `/notifications`,
`/bookmarks`, `/memory` (what Flick remembers), `/calendar`, `/settings`, `/share` (share target), `/join/:code`
(invite), `/call/:token` (call link), `/sign-in/*` and `/sign-up/*` (Clerk, inside Flick).

```bash
npm run dev        # Vite dev server (reads VITE_* from the repo-root .env)
npm run typecheck
npm run lint
npm test           # Vitest + React Testing Library (about 2,170 tests)
npm run build      # typecheck, then vite build (also builds the service worker)
npm run preview    # serve the build, to try the PWA
```

## How the code is organised

| Folder                                            | What lives there                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/{auth,chat,calls,profile,settings}` | One folder per feature: its store, server calls and components.                                                                                    |
| `src/components/ui`                               | Small shared UI pieces (Button, Avatar, Modal, ...).                                                                                               |
| `src/components/app`                              | App chrome: navbar, connection banner, full-screen states.                                                                                         |
| `src/lib/api` | `fetch` client (sends `Authorization: Bearer <Clerk token>` and `X-Device-Id`; a 401 signs out) and `api.call(ENDPOINTS.x.y, ...)`, typed and parsed from `@chat/contracts`. |
| `src/lib/realtime` | The `RealtimeTransport` interface, its connection-state machine and `socketTransport.ts`, a thin Socket.IO client (fresh Clerk token per connect, Socket.IO's own reconnect, acks as promises). |
| `src/features/auth` | Sign-in with Clerk: `authBridge.ts` (Clerk token + per-browser device id), `socketAuth.ts` (`getSocketAuth()` for the Socket.IO handshake), `useSessionStore` (the `/users/me` profile). |
| `src/features/chat/sync`                          | The sync protocol: `merge.ts` (pure ordering, dedupe, gap detection) and `syncEngine.ts` (buffering, paging, resync).                              |
| `src/features/chat/outbox`                        | Optimistic sends: the pure state machine, and the IndexedDB-backed store that resends with the same `client_message_id`.                           |
| `src/features/chat/content`                       | Content-renderer registry keyed by content type. A new message type is one new entry.                                                              |
| `src/features/organise` | Chat organisation: pin/archive/mute/favourite, filter tabs, wallpapers, chat lock, pinned and starred messages, forward, @mentions, drafts. |
| `src/features/search` | Message search (`GET /search`) and the safe snippet renderer. |
| `src/features/{ai,understand,translation}` | AI in the UI: Flick panel and assistant chat, writing help, translation, transcripts, "explain", conversation understanding. Every call is on request and respects the per-chat AI switch. |
| `src/features/safety` | Local scam, link and impersonation checks (no network, no AI). |
| `src/features/{productivity,reminders,scheduled,calendar,lists,notes}` | Bookmarks, digest, nudges, reminders, scheduled messages, events and calendar, folders and tags, private notes. |
| `src/features/{grouptools,platform}` | Slow mode, cards (checklist, expense, game, event), webhooks, passkeys, storage per chat, captions. |
| `src/features/content` | Rich messages: voice notes with waveform, GIF/sticker picker, polls, view-once, disappearing timer, link previews, video. Each one is an entry in the registry above plus a composer button. |

**State.** Everything is in Zustand: `useChatStore` (conversations, messages sorted by seq, receipts, typing, presence), `useOutboxStore` (unsent messages), `useSessionStore`, `useCallStore`. Server events reach the chat store through the sync engine, which decides what to apply and in what order.

**Delivery.** A message is shown pending (clock) until the `send_message` ack says it is stored; ticks come from the recipients' `receipt_update` cursors via `tickState`. A failed send keeps its `client_message_id`, so Retry cannot create a duplicate.

**Message list.** The list is virtualised with `@tanstack/react-virtual`, anchored to the end. Loading older pages keeps the reader's place. New messages scroll into view only when the reader is already at the bottom.

**Realtime.** `transport.send(...)` is a plain emit (typing, calls). `transport.request(...)` waits for the server's acknowledgement and never rejects: a missing answer after 20 s is a retryable `TIMEOUT`, a dropped socket is `OFFLINE`. On every connect and reconnect the session runs sync, then the outbox resends. `connect_error: unauthorized` signs the user out.

**Auth.** Sign-in is Clerk (`ClerkProvider`, prebuilt `SignIn`/`SignUp`/`UserButton`). Signed-out users see the sign-in page. The demo account is a pre-made Clerk user, documented in `docs/security/auth.md`.

**Chat organisation.** Per-chat settings are the caller's own `prefs` (`PATCH /conversations/:id/prefs`); the answer is copied into the chat store. The list loads the `all` and `archived` filters once, and the tabs (All, Unread, Favourites, Groups) filter locally. Drafts live in memory and `localStorage` (`flick:drafts`) and show as "Draft: ..." in the list. Pin, star and forward use REST and do not take a seq, so they do not arrive as sync events (pins are reloaded when a chat opens). A forward is a normal send with `forwarded: true` (reply link, mentions and view-once are dropped).

**Jump to a message.** The API has no "messages around seq N" call. Search results, pinned and starred messages open the chat and then load older history pages (keyset on `before_seq`, at most 20 pages) until the message is in the thread, then scroll to it. This keeps the thread one contiguous run of messages.

**Chat lock is a convenience lock, not security.** The browser hashes the passcode (PBKDF2-SHA-256, the conversation id as salt) and sends only the hash as `lock_hash`. The server stores it and does not enforce it; the messages stay readable through the API. A locked chat is hidden (no messages, no preview in the list or search) until the passcode is typed in this tab (kept in `sessionStorage`).

**Config.** `VITE_CLERK_PUBLISHABLE_KEY` (required), `VITE_API_URL` (API origin, no trailing slash and no `/api`, e.g.
`http://localhost:4000`), `VITE_APP_ENV`, and optional call settings `VITE_STUN_URLS`, `VITE_TURN_URL`,
`VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`. Socket.IO connects to the origin of `VITE_API_URL`; there is no separate
WebSocket URL. Values are baked in at build time.

**Sign-in.** `ClerkProvider` is given `signInUrl="/sign-in"`, `signUpUrl="/sign-up"` and `afterSignOutUrl="/"` (the same paths are set in the Clerk dashboard), so every
step stays inside Flick ([ADR-0020](../../docs/decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md)).

**Markdown and safety.** All message and AI text goes through one safe renderer (`features/content/richText`): no raw HTML,
only `http`, `https` and `mailto` links ([ADR-0021](../../docs/decisions/0021-markdown-rendering-everywhere.md)).

**Look and feel.** Tokens in `src/index.css`, themes in `tailwind.config.ts`, serif default font, hover styles only with a
pointer, a bottom tab bar on phones: see [`docs/design/design-system.md`](../../docs/design/design-system.md).

**Uploads and albums.** Files go straight to S3 with a presigned POST (`features/chat/upload.ts`). A multi-select send is
an album: several ordinary messages linked by `content.album` ([ADR-0019](../../docs/decisions/0019-albums-as-linked-messages.md)). The plan lives in `features/chat/album` (20 items, 2 GiB, 3 uploads at a time, caption on the first item). Photos and videos open in the full-screen viewer in `features/gallery`; a PDF opens through `GET /media/:id/url?preview=1`.

**Back button and gestures.** `src/lib/backStack.ts` keeps one history entry per open overlay; overlays opt in with `useBackClose(open, onClose)` (`src/lib/useBackClose.ts`). `src/lib/gestures` holds the edge-swipe maths and the iOS Safari exception, and `src/app/EdgeSwipeBack.tsx` mounts the swipe. In the installed app at the root, a second Back within 2 seconds exits ([ADR-0024](../../docs/decisions/0024-phone-back-navigation-and-gestures.md)). Call overlays and the guide tour are not wired yet.

**Wallpapers.** A chat's own wallpaper wins over the global one, which wins over the default (`features/organise/wallpaperPrecedence.ts`). The global one and uploaded pictures stay on this device ([ADR-0026](../../docs/decisions/0026-global-and-per-chat-wallpaper-precedence.md)).

## Fake login for browser tests (test only)

The real login (Clerk) needs a person, so the Playwright suite in `tests/e2e/` signs in another way.

- Build the web app with `VITE_E2E_FAKE_AUTH=true`. `vite.config.ts` then aliases `@clerk/clerk-react` to `src/features/auth/fakeClerk.tsx`, a tiny stand-in with the same few exports. Nothing else in the app changes: the API client, the Socket.IO handshake (`getSocketAuth`) and the device id work as usual.
- Open the app as `/?as=alice`. The name is kept in `sessionStorage`, so a reload stays signed in as alice. The token sent is `fake:alice`.
- The API accepts that token only when it runs with `E2E_FAKE_AUTH=true`, and it refuses to start with that flag when `NODE_ENV=production`.
- Without the flag nothing is aliased and the file is not in the bundle. Check with a normal build: `grep -r "flick.e2e_user" dist` finds nothing.

## Notifications, installable app and settings

Details in [`docs/features/pwa-and-push.md`](../../docs/features/pwa-and-push.md).

| Folder                         | What lives there                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pwa`                      | `sw.ts` (service worker: push, notification click, app-shell precache), install button, update toast, offline notice, `?c=` deep link.        |
| `src/features/notifications`   | Web Push subscribe/unsubscribe (`push.ts`), in-tab alerts and sound (`rules.ts` has the pure rules), the Settings notification switches.     |
| `src/features/settings`        | `/settings`: privacy, blocked users with unblock, `ReportDialog` (reuse it with `{ user_id }` or `{ conversation_id, message_id }`).          |

- The service worker is built only by `vite build` (not in `npm run dev`). To try it: `npm run build && npm run preview`.
- The chat store calls `notifyIncoming(...)` for each new message; nothing else in chat knows about notifications.
- The worker never caches API responses or tokens.
- Push needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` on the API and worker. Without them Settings says push is not set up.

## Docker

```bash
docker build -t flick-web \
  --build-arg VITE_API_URL=https://api.example.com \
  apps/web
docker run -p 8080:8080 flick-web   # nginx with SPA fallback; /healthz for probes
```

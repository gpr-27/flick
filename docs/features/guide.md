# Feature guide and tour

Flick teaches itself. A new person gets a short 10-step welcome tour once, and later, the first time
they open a feature, a short tip shows how to use it. Nothing is forced, a feature you already use is
never explained to you, and everything can be switched off or replayed in Settings > Guide and tips.
There is no AI in the guide; it is plain code and fixed text. Status: Built.

## Related

- [Settings](settings.md): the "Guide and tips" section
- [Features catalog](README.md): the complete list of what the tips cover
- [Chat list](chat-list.md): the "Take a 1-minute tour" and "Resume tour" card
- [PWA and push](pwa-and-push.md): the install and notification tips
- [Testing](../testing.md): how the guide is tested
- Code: `apps/web/src/features/guide/` (the guide), `apps/api/src/modules/users/repo/guide.ts` (the
  saved progress), contracts in `packages/contracts/src/rest/users.ts`.

## What is in it

42 topics: the **Welcome tour** (10 steps) and 41 first-open **tips**, listed in Settings under 8 areas.

| Area                          | Topics (count) | Examples                                                                                                         |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Getting started               | 7              | Welcome tour, chat list, new chat, people and inviting friends, notifications when closed, install, offline      |
| Writing messages              | 10             | Basics, attach, camera, voice notes, formatting and tables, schedule, GIFs and stickers, polls, emoji, view once |
| Reading and managing messages | 9              | Message actions, ticks, dates, jump to newest, disappearing, pinned, starred, search in chat, chat options       |
| Saved and search              | 3              | Saved messages, search your messages, scheduled messages                                                         |
| Groups                        | 2              | Create a group, group info                                                                                       |
| Calls                         | 5              | Voice, video and screen sharing, controls, group calls, the Calls tab                                            |
| Flick assistant               | 4              | Flick chat, ask Flick, group AI, suggest replies                                                                 |
| You and the app               | 2              | Profile, Settings                                                                                                |

The welcome tour steps are: your chats, start a new chat, type your message, add photos and files, do
more with any message, find anything again, voice and video calls, meet Flick, settings and your
profile, put Flick on your home screen. It lists `covers` so reaching its end marks the matching tips
as seen.

The four Flick assistant tips explain the optional AI features (see [AI overview](../ai/README.md)).

## What people see

- **Welcome tour** (10 steps). Starts by itself once for a new person, when the chat list is ready.
  Skip, Esc or the last step ends it. Closing early keeps the place: the chat list shows
  "Pick up the tour / Resume tour".
- **Existing people** (they have a chat with a real message in it, and an account older than a day)
  get a dismissible card at the top of the chat list: "New here? Take a 1-minute tour". Nothing
  starts by itself.
- **Tips**. A tip is a topic with one to three steps. It is queued when the screen of its feature
  shows, and appears when the rules below allow. "Got it", Esc, a click outside or
  "Don't show tips" all count as seen.
- **Guide and tips** in Settings: every topic by area with a status (New, Seen, Used), "Show me"
  for each, "Take the full tour again", the switch "Show tips as I use new features" and
  "Reset the guide". The user menu (the "?" in the bar, "More" on a phone) has "Take the tour".

## The rules that keep it polite

| Rule                                       | Where                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| One tip at a time, the others wait in line | `useGuideStore.queue`, `active`                          |
| At most one tip a minute                   | `scheduler.ts` (`TIP_COOLDOWN_MS`)                       |
| Never during a call (1:1 or group)         | `blockers.ts`, `GuideHost.tsx`; the overlay is unmounted |
| Never with another dialog or menu open     | `blockers.ts` (`layerOpen`)                              |
| Never while typing in a text box           | `blockers.ts` (`typingNow`, 5 seconds after a key)       |
| Never for a feature already used           | `markUsed`, `inferUsed.ts`, `isTipDue`                   |
| Never twice                                | a shown tip is added to `seen` at once                   |
| Waits for the server before deciding       | `settled`, so a known person is not shown a "new" tour   |

The overlay sits at `z-[55]`: above the app, below dialogs and below the call screens (`z-[60]`).
After a call ends, the tip "Controls during a call" is queued (the guide cannot speak during one).

## Where progress is kept

- On this device in `localStorage` under `flick.guide.v1`: it is read the moment the app opens.
- On the server in `user_settings.guide` (jsonb, migration 0013), through `GET /users/me/guide` and `PATCH /users/me/guide`. Shape: `{ seen, used, welcome_done_at, enabled, version }`.
- `PATCH` merges. `seen` and `used` entries are only ever added (an existing time is kept), the
  welcome time is set once, and only `reset: true` clears them. The row is locked while merging, so
  two devices saving at once keep both.
- The client sends changes about 1.5 seconds after they happen in one request, never blocks on it,
  and keeps them when offline (retry after 30 seconds, and when the browser comes back online).
  When it loads, it merges the server copy with its own (union; the earlier time wins).
- A different account on the same browser starts with an empty guide.

**Privacy.** Only topic ids (such as `composer.attach`) and times are stored. No message, name or
content. At most 200 topic ids of 1 to 64 characters from `[a-z0-9._-]`.

## Switching it off

- Unit tests: it is off when `MODE` is `test`. A guide test turns it on with
  `enableGuideForTests()` (`testing.tsx`) and back off with `disableGuideForTests()`.
- A browser test can change the wait between tips with `flick.guide.cooldown_ms` in `localStorage`
  (0 to 600000; the guide journey uses it so tips follow each other quickly, or stay away).
- Playwright: `signIn()` in `tests/e2e/tests/support.ts` stores `flick.guide.off = "1"` in an init
  script, which hides the guide on that browser without touching progress. Only the guide journey
  (`20-guide.spec.ts`) passes `guide: true`.

## Adding a topic

1. Add an entry to `TOPICS` in `catalog.ts`: `id` (never change it later), `area`, `title` and
   `steps` (`target`, `title`, `body`, optional `placement`). Plain, friendly words; a title under 60
   characters and a body under about 300.
2. Put `data-guide="<target>"` on the real element. One element can carry several ids separated by
   spaces (the phone's "+" menu stands in for the buttons folded into it). If the same id is on a
   laptop button and a phone menu entry, the one that is on screen is used. A missing or off-screen
   target shows a centred card, so a tip never breaks.
3. In the screen of the feature, call `useFeatureGuide('<id>', ready)` (or `useFeatureGuides([...])`).
   Pass `ready = false` until the target is on screen. A tip about something that opens in a dialog
   points at the button that opens it, because the guide never speaks over a dialog.
4. When the person really uses the feature, call `markUsed('<id>')` (or `useMarkUsedWhen`). If a
   chat list shows they used it already, add it to `inferUsed.ts`.
5. `catalog.test.ts` fails if the id is duplicated, a step has no copy, a target has no `data-guide`
   in `src`, or no screen asks for the tip.

A tour can list `covers`: topics it already showed. Reaching the end of the tour marks them as
seen, so the same thing is not explained again as a tip.

`scene` on a welcome step tells the host where the app should be (`list` closes the open chat,
`chat` opens Saved messages if no chat is open). "Show me" in Settings plays a topic from its
`route`; a topic that needs a chat of a certain kind (a group, a direct chat) shows a centred card
when that chat is not open.

## Accessibility

The card is a labelled `role="dialog"` with `aria-modal`; focus moves into it and goes back where it
was; Tab stays inside; Esc closes; left and right arrows change step; every step is announced in an
`aria-live` region; buttons are at least 44 pixels high and text is 16 pixels or more; animations
respect reduced motion. On a phone the card docks to the bottom above the home-bar area (or to the
top when the highlighted element is down there), so it never covers what it points at.

## Tests

- `apps/web/src/features/guide/*.test.ts(x)`: store (hydrate, merge, offline, reset, never
  reshow, one at a time, cooldown, suppression), overlay (target found or missing, keyboard, focus,
  axe), host (new or existing person, call, dialog), Settings, catalog (ids, copy, targets).
- `apps/api/test/integration/guide.int.test.ts` and the contract sweeps: merge, reset, limits,
  isolation between users.
- `tests/e2e/tests/20-guide.spec.ts`: laptop and phone journeys.

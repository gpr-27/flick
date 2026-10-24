# Testing

## Web

The web app (`apps/web`) is tested with Vitest, Testing Library and jsdom. Backend and browser (Playwright) tests have
their own sections in this file.

### Run it

```sh
cd apps/web
npx vitest run               # all tests
npx vitest run --coverage    # all tests + a coverage report (text summary, coverage/index.html)
npx tsc --noEmit -p .        # types (tests are type-checked too)
npx eslint .                 # lint (tests are linted too)
```

### What is covered

| Area                                                                                                                                                                                       | Where                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Every message content type, drawn and previewed (bubble, chat list, reply quote, pinned bar, forward dialog, search) with awkward text (10k characters, unbroken strings, RTL, emoji only) | `src/features/chat/contentMatrix.test.tsx`              |
| Sync engine: gaps, duplicates, out of order, reconnect, `delivery_ack` rules                                                                                                               | `src/features/chat/sync/syncScenarios.test.ts`          |
| Outbox: offline queue, ordering after reconnect, retry, discard, dedupe by `client_message_id`                                                                                             | `src/features/chat/outbox/outboxScenarios.test.ts`      |
| Receipts and ticks for direct chats and groups                                                                                                                                             | `src/features/chat/receipts.test.ts`                    |
| Chat store: edit, delete and reaction events, typing and presence timers, mark read, optimistic actions, groups                                                                            | `src/features/chat/useChatStore.test.ts`                |
| Chat session wiring: order after connect, drop and reconnect, every realtime event, presence subscriptions                                                                                 | `src/features/chat/chatSessionScenarios.test.ts`        |
| Session store and device id clash retry                                                                                                                                                    | `src/features/auth/sessionScenarios.test.ts`            |
| 1:1 call state machine: offer, answer and ICE order, glare, busy, timeouts, reconnect grace, devices, screen share                                                                         | `src/features/calls/useCallScenarios.test.ts`           |
| Call screens: incoming call dialog, call overlay                                                                                                                                           | `src/features/calls/callUi.test.tsx`                    |
| Message action sheet: hold, right-click, button, 350 ms arm delay, keyboard, every action                                                                                                  | `src/features/chat/components/MessageMenu.test.tsx`     |
| Composer: send, draft, typing signal, emoji, reply, edit, attachments and uploads                                                                                                          | `src/features/chat/components/composer.test.tsx`        |
| Open chat: states, messages, typing row, read marking, announcements, lock screen, image viewer                                                                                            | `src/features/chat/components/chatContainer.test.tsx`   |
| Chat list: states, rows, badges, ordering, filters, keyboard, dialogs                                                                                                                      | `src/features/chat/components/chatList.test.tsx`        |
| Chat header, GIF and poll buttons, pinned bar                                                                                                                                              | `src/features/chat/components/chatHeader.test.tsx`      |
| Group info (roles), new chat, new group                                                                                                                                                    | `src/features/chat/components/groupAndNewChat.test.tsx` |
| Chat options menu, lock dialogs, forward dialog                                                                                                                                            | `src/features/organise/chatOptions.test.tsx`            |
| Pins, stars, starred panel, jump to a message                                                                                                                                              | `src/features/organise/pinsStarsJump.test.tsx`          |
| Settings, privacy, blocked users, notification permission flow, profile, sign-in, PWA banners and install button                                                                           | `src/features/settings/settingsScreens.test.tsx`        |
| AI: model labels, task state machine, panel, translate, suggested replies                                                                                                                  | `src/features/ai/aiScenarios.test.tsx`                  |
| App shell and routes                                                                                                                                                                       | `src/app/App.test.tsx`                                  |
| Responsive (phone and laptop controls)                                                                                                                                                     | `src/responsive.test.tsx`                               |
| Dates, ids, key-value store, uploads, image and video helpers, waveform, notification rules, sound, deep links, toasts                                                                     | `src/lib/utilities.test.tsx`                            |
| Client configuration                                                                                                                                                                       | `src/config/env.test.ts`                                |

### Test helpers (`apps/web/test`)

- `fakes.ts`: `FakeTransport` (a fake socket), `fakeApi`, data builders (`makeMessage`, `makeConversation`).
- `webrtcFakes.ts`: fake `RTCPeerConnection`, streams and `navigator.mediaDevices`.
- `layout.ts`: gives jsdom enough geometry for the virtualised message list to draw rows.
- `a11y.ts`: `expectNoA11yViolations(container)` runs [axe-core](https://github.com/dequelabs/axe-core). `a11y.test.tsx`
  proves the helper does fail on a nameless button, a missing alt text, an unlabelled input and a bad ARIA role.
- `viewport.ts`: `isVisibleOn(element, 'phone' | 'laptop')` and `mockViewport`.
- `matchers.ts`: `like(shape)`, a typed `expect.objectContaining`.

### Accessibility checks

axe-core runs on: sign-in, chat list (full, empty, error, loading), open chat (messages, empty, locked), message action
sheet (actions and delete step), settings page, notification settings, call overlay (video, voice, calling), incoming
call dialog, composer (plain, emoji picker, replying, editing), forward dialog, chat options menu and mute dialog,
group info, new chat, Ask Flick, translate, pinned bar, profile, signed-in app shell. No violations were found.

axe runs with three rules switched off, because jsdom has no layout engine: `color-contrast` (needs painted colours),
`region` (a fragment is not a page) and `scrollable-region-focusable` (needs scroll sizes). Colour contrast is therefore
**not** checked by these tests.

### Responsive checks

The phone/laptop split is Tailwind classes (`max-sm:` / `sm:`), and jsdom does not apply CSS. The tests therefore read
the class conventions: an element counts as hidden on a viewport when it, or an ancestor, carries the class that hides it
there. This proves the right controls are present on each layout; it does not prove how they look.

### Coverage (measured)

`npx vitest run --coverage` in `apps/web`: 65 test files, 1259 tests (before this work: 41 files, 319 tests).

| Folder                       | Files | Statements | Branches   | Functions  | Lines      |
| ---------------------------- | ----- | ---------- | ---------- | ---------- | ---------- |
| `src/(src root)`             | 2     | 0.0%       | 0.0%       | 0.0%       | 0.0%       |
| `src/app`                    | 1     | 97.8%      | 100.0%     | 94.7%      | 100.0%     |
| `src/components/app`         | 4     | 97.1%      | 100.0%     | 92.3%      | 96.8%      |
| `src/components/ui`          | 15    | 89.8%      | 87.3%      | 96.7%      | 90.8%      |
| `src/config`                 | 1     | 100.0%     | 81.8%      | 100.0%     | 100.0%     |
| `src/features/ai`            | 11    | 93.6%      | 86.3%      | 96.5%      | 98.3%      |
| `src/features/auth`          | 5     | 84.8%      | 85.7%      | 76.9%      | 85.9%      |
| `src/features/calllog`       | 2     | 89.3%      | 83.6%      | 78.3%      | 91.0%      |
| `src/features/calls`         | 5     | 89.5%      | 85.4%      | 89.4%      | 90.6%      |
| `src/features/chat`          | 28    | 95.9%      | 92.0%      | 93.5%      | 96.4%      |
| `src/features/content`       | 18    | 92.7%      | 81.6%      | 90.4%      | 94.7%      |
| `src/features/groupcall`     | 9     | 84.3%      | 67.7%      | 77.3%      | 88.6%      |
| `src/features/notifications` | 7     | 95.4%      | 82.4%      | 97.1%      | 98.1%      |
| `src/features/organise`      | 14    | 96.6%      | 89.3%      | 97.4%      | 97.8%      |
| `src/features/profile`       | 1     | 100.0%     | 100.0%     | 100.0%     | 100.0%     |
| `src/features/search`        | 3     | 95.2%      | 76.3%      | 94.1%      | 94.4%      |
| `src/features/settings`      | 6     | 93.0%      | 78.7%      | 97.7%      | 97.3%      |
| `src/lib`                    | 6     | 97.2%      | 88.9%      | 97.4%      | 98.4%      |
| `src/lib/api`                | 4     | 88.2%      | 79.4%      | 77.3%      | 91.0%      |
| `src/lib/realtime`           | 7     | 88.0%      | 80.9%      | 80.0%      | 91.1%      |
| `src/pwa`                    | 7     | 77.9%      | 78.0%      | 84.4%      | 74.7%      |
| **All of `src`**             | 156   | **92.7%**  | **86.23%** | **91.53%** | **94.15%** |

Coverage counts every source file, including ones no test imports.

### Not covered

- `src/main.tsx` (the entry point) and `src/pwa/sw.ts` (the service worker) have no tests; the worker runs in a
  separate context that jsdom cannot host. `src/lib/api/endpoints.ts` is only reached through the API client tests.
- Real browser behaviour: layout, CSS, colour contrast, real WebRTC media, real IndexedDB, real push, touch gestures
  on a device. The Playwright tests (`tests/e2e`) are the place for those.
- The group call (LiveKit) store has the lowest branch coverage (67.7%): several error paths are only reachable with a
  real LiveKit server.
- The call overlay has no self-view drag or resize, no fit/fill toggle, and the incoming-call dialog starts no ring
  sound. These features do not exist in the code at this commit, so there is nothing to test yet.
- There is no install guide or install card screen at this commit (only the install button and the update and offline
  banners), so no test covers one.

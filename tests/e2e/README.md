# Browser tests (Playwright)

Real Chromium browsers talk to a throwaway copy of the whole app: Postgres 17, Redis 7 and MinIO in
docker, the API, the worker and the web app. Login is faked (`E2E_FAKE_AUTH` on the API,
`VITE_E2E_FAKE_AUTH` on the web build); see `apps/web/README.md`.

Every journey runs on two profiles ("projects"):

| project  | what it is                                                                              |
| -------- | --------------------------------------------------------------------------------------- |
| `laptop` | 1440 x 900 Chromium, a mouse (right-click opens a message's actions)                    |
| `phone`  | 390 x 844 Chromium, touch, `isMobile`, an iPhone user agent (a hold opens the actions)  |

```bash
npx playwright install chromium   # once
npm run e2e                       # start the stack, run every journey on both profiles, tear down
npm run e2e:screenshots           # write docs/screenshots/*.png
node tests/e2e/run.mjs --serve    # keep the stack up; open <web url>/?as=alice by hand
```

Everything after `npm run e2e --` goes to `playwright test`:

```bash
npm run e2e -- --project=laptop                 # laptop only
npm run e2e -- --project=phone                  # phone only
npm run e2e -- --headed --project=phone         # watch it (a window per person)
npm run e2e -- 16-calls                         # one spec file (any part of the name works)
npm run e2e -- 16-calls --project=laptop -g "video call"   # one test of one spec on one profile
npm run e2e -- --repeat-each 3                  # prove it is not flaky: every test three times
npm run e2e -- --workers=1                      # on a slow or busy machine
```

If `npm` does not work in a git worktree, call the pieces directly: `node tests/e2e/run.mjs ...` and
`npx tsc --noEmit -p tests/e2e`.

To iterate on one test without a new stack each time, start one with `--serve` and, in another
terminal, run `E2E_WEB_URL=<web url> E2E_API_URL=<api url> npx playwright test --config tests/e2e/playwright.config.ts <spec>`.
(A change to the web app needs a new build; `--serve` builds it once at the start.)

## How it is built

- `stack.mjs` starts and stops the stack (containers are named `chat-e2e-*`, ports are random).
  If `DATABASE_URL` and `REDIS_URL` are set it uses those instead of docker (CI does this).
- Logs of the API, worker and web server are in `tests/e2e/.logs/`; traces, screenshots and
  diffs of failures in `tests/e2e/.results/`, the HTML report in `tests/e2e/.report/`.
- `playwright.config.ts` defines the two projects, the fake camera and microphone
  (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) and a few WebRTC flags
  that let two browsers on one machine find each other (loopback candidates, no mDNS names).
- `tests/support.ts` holds the helpers every spec uses. A "person" is one browser context signed in
  as one fake user, so two people are two real browsers. The helpers hide the differences between
  the profiles (`doAction` = right-click or hold, `composerAction` = a button or the "+" menu,
  `openGroupInfo`, `closeChat`, `goTo`, ...), so a journey reads the same on both. `isPhone()` is
  there when a test must know.
- Every test makes its own users (`uniqueName`), so tests never share state and run side by side.
  No test sleeps: they wait for what they expect (`expect`, `expect.poll`).
- Not part of `npm test`. CI: `.github/workflows/e2e.yml` (runs both profiles).

## The journeys

| file                                  | what it covers                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `01` ... `08`                         | live message, ticks, offline catch-up, duplicate retry, group, reactions/edit/delete, phone smoke test, delivered-when-opened |
| `09-messaging`                        | both directions, emoji, very long text and word, Enter / Shift+Enter, line breaks, reply and jump, forward, edit, delete for me / everyone, reactions, copy |
| `10-organise-messages`                | star and the starred list, pin / unpin and the pinned bar, search, @mentions in a group                           |
| `11-media`                            | photo and file through MinIO, voice note (waveform, a duration that fits its bubble, play/pause), GIF picker without a GIPHY key |
| `12-chats`                            | group lifecycle, pin / favourite / mute / archive / wallpaper, chat lock, disappearing timer, polls, view-once    |
| `13-delivery`                         | ticks in a group of three while two members are away, an offline queue that arrives once and in order             |
| `14-phone-layout` (phone only)        | one top bar, wide message box, "+" menu, action sheet size, no sideways scroll, keyboard-safe message box         |
| `15-install` (phone only)             | install card, Add to Home Screen steps, two-week snooze, `beforeinstallprompt` -> `prompt()`, already installed   |
| `16-calls`                            | real WebRTC voice and video calls: ring tone, accept, connected, mute, camera, fit/fill, self-view drag and resize |
| `17-settings-profile`                 | theme, profile, privacy, read receipts, signing in as someone else in the same browser                            |
| `18-resilience`                       | a slow line (HTTP and WebSocket), a dropped WebSocket that recovers through sync                                  |
| `19-visual`                           | `toHaveScreenshot` of six key screens on each profile                                                             |

### Calls

Two contexts each get a fake camera (a moving picture) and microphone (a beep), so the media really
flows. The tests hook `AudioContext` with an init script to see the ring tone start (440/480 Hz)
and stop, and read `videoWidth` of the remote picture to prove it decoded. The green Accept button
bounces forever, which Playwright would wait on, so the tests click it with `force`. Starting a
screen share needs a screen to pick, so only the control's presence is checked.

### Visual baselines

`19-visual` compares six screens per profile with pictures in
`tests/e2e/screenshots-baseline/<platform>/<profile>/`. Fonts are drawn differently on macOS and
Linux, so each platform has its own set; only `darwin` is committed. Everything that changes from
run to run is handled in the test: display names are fixed through the API (user names are random),
times are masked, finite animations are run to their end, and the page has a flat background and no
soft shadows so each picture stays under 150 KB.

```bash
npm run e2e -- 19-visual                        # compare
npm run e2e -- 19-visual --update-snapshots=all # accept the new look (or write a platform's first set)
node tests/e2e/optimise-baselines.mjs           # then shrink the files, losslessly
node tests/e2e/optimise-baselines.mjs --check   # fail if any is over 150 KB
```

On a platform with no pictures yet, CI skips `19-visual` with a message instead of failing; on a
developer machine the first run writes them.

### What is not covered

- A server restart (the stack cannot be restarted from a test).
- Starting a screen share (needs a screen to pick), a real iOS keyboard or notch, and a real
  Add to Home Screen. These are simulated: a smaller window for the keyboard, a synthetic
  `beforeinstallprompt`.
- Editing the profile: the app has no screen for it yet (the page is read-only).
- Multi-line messages cannot be typed (the message box is one line); a received one is checked
  by sending it through the API.
- GIPHY results: the stack has no GIPHY key, so the picker's "not set up" state is what is checked.

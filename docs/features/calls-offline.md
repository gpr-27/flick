# Calls to people who are offline or have Flick closed

A 1:1 voice or video call can reach someone whose Flick is closed, in the background, or whose phone is locked, as a push notification with Answer and Decline buttons. It is best effort and it is not a phone call: a browser cannot ring like the phone app. When the callee is offline, the API parks the caller's offer in Redis for 45 seconds, queues a Web Push through the worker, and hands the offer over when the callee opens Flick from the notification. This page explains the flow, the honest limits per platform, the permission prompts, and how it is tested.

Related: [calls.md](calls.md) | [pwa-and-push.md](pwa-and-push.md) | [notifications.md](notifications.md) | [settings.md](settings.md) | [../operations/runbook.md](../operations/runbook.md) | [../operations/deployment.md](../operations/deployment.md)

Code: `apps/api/src/modules/gateway/{calls,parked-calls,call-push}.ts`, `apps/worker/src/jobs/call-push.ts`, `apps/web/src/pwa/{callPush,sw}.ts`, `apps/web/src/features/calls/`.

**Status: Partial.** Built end to end in code and covered by unit, integration and headless browser tests. Not verified in automated tests: the real push, the notification buttons and the vibration on real phones (check by hand, see "Tests"). Gaps: group calls and call links are not part of this; delivery depends on the browser vendor's push service and the phone's battery and notification settings; if the API replica that took the offer dies, a missed call may go unlogged.

AI: none.

## What it does, and what it cannot do

A 1:1 voice or video call can reach someone whose Flick is closed, in the background, or whose
phone is locked, **as a notification with Answer and Decline buttons**. It is best-effort.

It is **not** a phone call. Be honest about this wherever it is described:

- A browser cannot ring like the phone app. There is no full-screen ringing screen, no ringtone
  that plays from a closed app, and no bypass of silent or Do Not Disturb. The only tools are a
  notification, its sound as the OS plays it, and a vibration pattern (where the platform allows).
- **iPhone and iPad**: web push only reaches Flick if it was added to the Home Screen
  (installed PWA, iOS 16.4 or later). In a Safari tab there is no push at all. iOS shows a normal
  banner; it cannot show a full-screen incoming call, and the vibration pattern and the
  "stay until tapped" flag are ignored.
- **Android (Chrome)**: a heads-up notification with the Answer and Decline buttons, vibrating.
  How long it stays up and how loud it is depends on the phone's notification settings and battery
  saver. Chrome may hold or delay the push in Doze.
- **Desktop**: an operating-system notification (Chrome, Edge, Firefox). Whether buttons are shown,
  and whether it stays until clicked, depends on the OS.
- Delivery goes through the browser vendor's push service (FCM, Mozilla, Apple). It can be late
  or lost. A late ring is useless, so the push is only kept for about 30 seconds.
- If the person never allowed notifications, or has no subscription, nothing can ring them and the
  caller sees "not reachable" at once.

## The flow

```
Alice taps call
   |  call_offer (WebSocket)
   v
API: is Bob online?  -- yes --> relay the offer to his devices (as always, no push)
   | no
   v
Bob has an enabled push subscription?  -- no --> caller gets call_unavailable "unreachable"
   | yes
   v
1. state for both users in Redis, with a short TTL (window + 15 s)
2. PARK the offer: Redis  call:parked:<bob>:<call>  (45 s TTL)
   + one-time decline token  call:decline-token:<call>
   + Alice's ICE candidates keep being appended  call:parked-ice:<bob>:<call>
3. queue pg-boss job "call-push" {kind: ring}      ---> worker ---> Web Push
4. in-process timer for the window (45 s + 250 ms)
```

Web Push for a ring: `Urgency: high`, `TTL: 30` seconds. The worker re-checks before sending: it
skips the ring if the call is no longer parked (cancelled or expired while the job waited) or if Bob
came online in the meantime.

### Bob's side

- **He taps Answer** on the notification. The service worker opens (or focuses) Flick at
  `/?answer=<call id>`. The app signs in and connects. Right after the handshake the gateway finds
  the parked offer (looked up from Bob's call state, so no key scan) and emits `call_offer` followed
  by the stored `call_ice` events, exactly as if Bob had been online. It does this once more after
  his first `sync_request`, so a slow-binding client cannot miss it; the client ignores a repeated
  offer with the same call id. The usual incoming-call screen appears with **Accept** focused. The
  app does not accept by itself: the browser needs a user gesture for the microphone and camera.
- If the offer is gone (the caller hung up, or the window passed) the app says "That call has ended."
  after 12 seconds.
- **He taps Decline**. The service worker has no login, so it `POST`s to
  `/calls/decline-from-push` with `{call_id, token}`. The token came inside the encrypted push for
  this one call and lives only as long as the parked offer. The API checks it against Redis in
  constant time, relays `call_reject` to Alice, logs a declined call, and clears the parked offer.
  This is best-effort: if the request fails the notification is gone anyway and Alice's call times
  out. If a push has no token the notification shows only Answer.
- **He opens Flick himself** inside the window: the same hand-over happens, and the app closes the
  "is calling" notification (`getNotifications({tag})`).

### When the call ends without being answered

| What happened                          | Server does                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Alice cancels (`call_end`)             | clears the parked offer, queues a **cancel** push, logs a **missed** call                |
| Alice's connection drops for over 10 s | same as cancel                                                                           |
| 45 s pass with no answer               | tells both sides `call_end` (`timeout`), cancel push, logs a **missed** call             |
| Bob declines (app or notification)     | relays `call_reject`, clears the parked offer, logs **declined**; no cancel push         |
| Bob answers                            | clears the parked offer; the call continues as a normal call (state TTL back to 6 hours) |

The cancel push uses the same notification tag as the ring, so the browser **replaces** the "is
calling" notification with "Missed video call from X" (a push must always show something, so it
cannot simply vanish). It is a normal-urgency push with a one-hour TTL. If the ring was never
delivered, Bob still learns that he missed a call.

The call log row and the "missed call" chat message are the existing `recordCall` (idempotent on the
call id), so the Calls tab and the chat show the missed call like any other.

## Limits of the server side

- The 45 s window is an in-process timer on the API replica that took the offer. Redis keys expire by
  themselves and a call state left behind by a crashed replica disappears after about 60 s, but if
  that replica dies a missed call may not be logged and no cancel push is sent; the ring
  notification then just expires with its 30 s TTL. The caller's app also gives up after 45 s.
- Only one device can be parked per person in the sense that every device that connects in time is
  offered the call; the first to answer wins and the others get `answered_elsewhere`.
- Calls to a person who is online but has the tab frozen in the background (common on phones) still
  go over the socket as before; no push is sent, so such a call may not be noticed. Presence
  decides, not whether the page is actually awake.
- If the worker has no VAPID keys it only logs "SIMULATED call push" (as for message pushes). A
  call to someone with a subscription then parks and times out without anything reaching a device.
- Group calls (LiveKit) and call links are not part of this.

## Permission UX

The browser prompt is only ever shown after a click, never on page load.

- **Calls tab** shows a card (`CallNotificationCard`): "Allow notifications so you receive calls when
  Flick is closed." with an **Allow notifications** button. It fetches the VAPID key first, so the
  prompt follows the click immediately, then uses the existing `enablePush` and `POST /push/subscribe`.
- After a person's **first call (placed or received) ends**, the same card appears once at the bottom
  of the screen (`CallPermissionPrompt`), so it never covers a call. "Not now" or an answer is
  remembered in `localStorage` (`flick.callNotifPromptDone`).
- **Blocked**: the card explains how to undo it for iOS, Android and desktop. A page cannot re-open
  the prompt once the browser has blocked it.
- **iPhone/iPad in a Safari tab**: the card says to add Flick to the Home Screen first.
- Nothing is shown if the server has no VAPID key.
- The existing Settings > Notifications switch is the same subscription (calls and messages share it).

## Tests

- Unit: `apps/web/src/pwa/callPush.test.ts` (parsing, notification content, what a tap does, the
  decline request), `features/calls/callPermission.test.ts`, `CallNotificationCard.test.tsx`,
  `useAnswerFromNotification.test.tsx`, and new cases in `useCallStore.test.ts`.
- API integration: `apps/api/test/integration/calls-offline.int.test.ts` (parking, delivery on connect
  with the ICE candidates, no subscription, disabled subscription, caller cancel, window expiry,
  expired-but-not-yet-cleaned offer, decline with token, online callee gets no push).
- Worker integration: `call push` in `apps/worker/test/integration/jobs.int.test.ts`.
- Playwright: `tests/e2e/tests/09-call-offline.spec.ts` covers what a headless browser can: the parked
  offer reaches a callee who opens Flick (with `?answer=`) inside the window, and not after a
  hang-up; and "not reachable" with no subscription.
- **Not tested automatically**: the real push, the notification, its Answer/Decline buttons and the
  vibration. They need a real browser with a push service (and a phone for iOS and Android).
  Check by hand: build and preview the web app over HTTPS (or localhost), turn notifications on in
  Calls, close the tab, call from another account, and use DevTools > Application > Service Workers.

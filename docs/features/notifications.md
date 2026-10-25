# Flick: notifications, end to end

Code: `apps/api/src/modules/dispatcher/notify.ts` (who is alerted), `apps/worker/src/jobs/notify.ts`
and `web-push-provider.ts` (the push), `apps/api/src/modules/{push,notifications}/` (routes),
`apps/web/src/features/notifications/` (subscribe, prompt, settings panel, notification centre),
`apps/web/src/pwa/sw.ts` (service worker). Migration `0017_notifications`.

## The pipeline

```
send message -> API (one transaction: message + outbox row)
  dispatcher (API process): emits new_message to connected sockets, then for each member who is
  not the sender and not muted (a mention or a reply to them gets through a muted chat):
     - writes a notification-centre row (offline people, and mentions/replies to anyone)
       and emits `notification_created` to them
     - queues a pg-boss "notify" job: at once if they have no socket, after 8 s if they do
  worker "notify" job: re-checks (message deleted/expired? left? muted? chat already read?),
     writes the centre row if missing, then for each of the person's devices:
        device already has the message (its delivery receipt is in)  -> skip
        device inside its quiet hours                                -> skip
        otherwise web-push (urgency high, TTL 1 day); 404/410 -> disable that subscription
  push service (FCM / Mozilla / Apple) -> service worker `push` event -> ALWAYS showNotification
  tap -> `notificationclick` -> focus the open window (or open one) at /?c=<chat>&m=<msg>&s=<seq>
         -> the app opens the chat and scrolls to the message (features/organise/jump)
```

## Who gets a push

| Situation                                              | Centre row | Push                           |
| ------------------------------------------------------ | ---------- | ------------------------------ |
| Offline member, chat not muted                         | yes        | yes, at once                   |
| Connected member (app open and receiving)              | no         | no (the delivery receipt wins) |
| Connected-looking member whose app is frozen or closed | yes        | yes, after 8 s                 |
| Muted chat, plain message                              | no         | no                             |
| Muted chat, mention of the person or reply to them     | yes        | yes                            |
| The sender, and the sender's other devices             | no         | no                             |
| System and call-event messages, bots                   | no         | no                             |
| Device inside its quiet hours                          | yes        | no (that device)               |
| Device with "Message previews" off                     | yes        | yes, text "New message"        |
| Chat already read when the job runs                    | no         | no                             |
| No push subscription at all                            | yes        | no (logged: `no_subscription`) |

Calls have their own pushes (`call-push`) and are not covered here.

## What it says

Title: the sender (group: "Sender in Group"). Body: first ~100 characters, or "Sent you a photo /
a voice message / a video / a poll / a file", "Photo: caption". Messages of one chat share a `tag`
and `renotify`, so the shade shows "Bob: 3 new messages" instead of one line each (a retried push is
not counted twice). `data` carries the chat id, message id and seq.

## Why people got nothing (root causes found)

1. **Almost nobody was subscribed.** Subscribing only happened on a tap in a prompt that was hidden
   for ever after one "Not now", and was not offered at all in iPhone browser tabs. A lost or
   replaced subscription (browser cleanup, push service rotation, VAPID key change) was never
   repaired. Production had 2 rows, both from one desktop.
   Fix: at every app start the app re-checks the browser subscription and the server's copy
   (`GET /push/status`, compared by endpoint fingerprint), re-subscribes and re-registers when
   needed, also on `pushsubscriptionchange` and when the app returns to the front.
2. **`navigator.serviceWorker.ready` can wait for ever** when no worker is registered, leaving every
   control "loading". It now times out after 5 s.
3. **Connected-looking people were never pushed.** A frozen background tab or a just-closed phone
   app keeps its socket for up to a minute, so no job was queued. Now they get a delayed job that
   pushes unless a delivery receipt arrived.
4. **Revoked (signed-out) devices still got pushes**, and subscription rows never knew their device
   (`device_id` was never set). Both fixed; one row per device (a renewed endpoint replaces the old).
5. **Muted chats swallowed mentions**, and system messages notified everyone. Fixed.
6. **Previews / quiet hours were browser-only** so pushes ignored them. The device now sends them
   with its subscription and the worker applies them per device.
7. The service worker already always shows a notification (never a silent push); a bad payload
   shows a generic one.

## Platforms

- **iPhone / iPad**: Web Push works only in the Home Screen app (iOS 16.4+). In a Safari tab the app
  says "Add Flick to your Home Screen first, then open it from there and turn on notifications" and
  opens the install guide.
- **Android (Chrome)**: works in the browser and the installed app. Battery savers can delay pushes.
- **Desktop**: Chrome, Edge, Firefox work with the browser closed only if the browser process runs.
- Denied permission: the banner and Settings show steps for the platform.

## Settings > Notifications

Shows "This device: On/Off (why)", "Other devices: N", the switch, **Send me a test notification**
(`POST /push/test`, 3 a minute, only to your own devices; shows per device sent / expired / failed
with the push service host and HTTP status) and troubleshooting tips.

## Notification centre

Bell in the navbar (and "Notifications" in the phone menu), route `/notifications`. Table
`notifications` (user, chat, message, kind message|mention|reply|reminder|missed_call, created_at,
read_at), kept 30 days (hourly purge job; the list also hides older rows). No text is stored: the
preview is read from the message when listed, so deleted, expired or hidden messages show as
unavailable. An alert counts as read when marked, or when the chat is read up to that message.
Endpoints: `GET /notifications` (keyset), `GET /notifications/unread`, `POST /notifications/read`
(`{ids}` or `{all:true}`), `DELETE /notifications`; live event `notification_created`.
Reminders and missed calls can write rows with kinds `reminder` / `missed_call`.

## Render free tier

The free instance sleeps after about 15 minutes without traffic. An incoming message wakes it, but
the minute jobs (reminders, scheduled messages, purges) only run while it is awake. Use an external
uptime pinger on `/health/live` every 5-10 minutes if those must run on time. The API process also
needs `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (same service as the worker on Render) for the test button.

## Logs

The worker writes one info line per attempt, `notify`: user id, kind, `result` (`sent`,
`no_subscription`, `all_devices_skipped`, `push_failed`, `skipped_muted`, `skipped_seen`,
`skipped_gone`), subscription counts, skips (delivered / quiet), expired, failed and a list of
`{host, status}` per push service. Never endpoints or keys.

## Troubleshooting

1. Settings > Notifications > **Send me a test notification**.
   - "No subscription": turn the switch on (allow in the browser prompt).
   - "accepted" but nothing shows: OS-level settings (Focus / Do not disturb, battery saver,
     notifications off for the browser or app).
   - "expired": open Flick on that device; it re-subscribes by itself.
   - "failed, status 401/403": the VAPID keys on the server changed; open Flick again.
2. Check the worker log line for the message: `result` tells which rule stopped it.
3. Muted chats and quiet hours are silent by design.

Not verifiable without real phones: actual delivery through FCM / Apple on Android and iOS.

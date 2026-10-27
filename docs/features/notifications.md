# Notifications

Flick tells you about new messages in five ways: a bell with a **notification centre**, an in-app
**banner**, a short **sound** (and vibration), a **push** notification when the app is closed, and
the **app badge** on the icon. You control them in Settings > Notifications. There is no AI in
notifications. This page also covers quiet hours, priority contacts, keyword alerts, the digest, the
morning briefing, login alerts and the desktop Reply box. Status: Built, with the gaps listed at the
end.

## Related

- [PWA and push](pwa-and-push.md): installing, the service worker, push set-up
- [Settings](settings.md): where each switch lives
- [Chat list](chat-list.md): mute durations, briefing card, snooze
- [Reminders](reminders.md): the Reminder push and the follow-up nudges
- [Operations runbook](../operations/runbook.md): logs and the free-tier sleep

## At a glance

| Feature                          | Where                                                      | Works when                                                         | Status  |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| Notification centre              | Bell in the top bar (`/notifications`)                     | Always (kept 30 days)                                              | Built   |
| Incoming banner                  | Top of the screen                                          | App open, chat not on screen                                       | Built   |
| Message sound, volume, vibration | Settings > Notifications                                   | App open in the background or another chat                         | Built   |
| Call ringtone                    | Settings > Notifications                                   | When someone calls                                                 | Built   |
| Message previews                 | Settings > Notifications                                   | Desktop and push text                                              | Built   |
| Push notifications               | Settings > Notifications, install prompt                   | App closed                                                         | Built   |
| Test notification                | Settings > Notifications                                   | Needs push on                                                      | Built   |
| Quiet hours (device)             | Settings > Notifications > Quiet hours                     | This device                                                        | Built   |
| Quiet hours (account)            | Settings > Notifications > "Quiet hours (push and sounds)" | All your devices                                                   | Built   |
| Priority contacts                | Settings > Notifications                                   | Copied to the server, so they apply to quiet hours on every device | Built   |
| Keyword alerts                   | Settings > Notifications                                   | App open only                                                      | Partial |
| Notification digest              | Settings > Notifications (next to the push switch)         | App open only                                                      | Built   |
| Morning briefing                 | Settings > Notifications                                   | Needs the worker running                                           | Built   |
| Login alerts                     | Settings > Account                                         | On a sign-in from a new device                                     | Built   |
| App badge                        | The installed app icon, browser tab title                  | Where the browser supports it                                      | Built   |
| Desktop Reply                    | Message notifications on Chrome and Edge desktop           | Push shown                                                         | Partial |

## Notification centre

The bell (and "Notifications" in the phone menu) opens `/notifications`. Alerts are grouped by day
("Today", "Yesterday", then dates). Each has the chat name, a preview and an unread dot. Tap one to
open the chat at that message. **Mark all as read** and **Clear** (tap twice to confirm) sit at the
top. At the bottom of the list is the **Did you follow up?** section (see [reminders](reminders.md)).

- Kinds: message, mention, reply, reminder, missed call. Kept 30 days (hourly purge job).
- No message text is stored in the table. The preview is read when you open the list, so deleted,
  expired or hidden messages show "This message is no longer available."
- An alert counts as read when you mark it, or when the chat is read up to that message.
- Endpoints: `GET /notifications`, `GET /notifications/unread`, `POST /notifications/read`,
  `DELETE /notifications`. Live event `notification_created`. Code:
  `features/notifications/center/`, `apps/api/src/modules/notifications/`.

## Banner and sound (app open)

`notifyIncoming.ts` decides what to do for each live message from someone else:

- Tab hidden: a desktop `Notification` (one per chat) and a sound.
- Tab visible but that chat is not the open one: a tappable **banner** for 5 seconds (a newer
  message restarts the timer) and a sound.
- Never for: your own messages, deleted messages, system, call-event and poll-vote messages, and
  catch-up messages older than 60 seconds.
- At most one sound per second. The sound is made with the Web Audio API (no audio file).
- Muted chat: silent, unless the message mentions you or contains one of your keyword alerts.
- Per-chat sound: [Colour and sound](search-and-organise.md) can give one chat its own sound.

Settings: Message sound on/off, Volume with a Test button, Call ringtone, Vibration, Message previews
(off shows only "New message").

## Push (app closed)

Push needs the app installed or the browser open, a permission and a subscription. Details of the
set-up are in [pwa-and-push](pwa-and-push.md). How a message becomes a push:

```
send message -> API (one transaction: message + outbox row)
  dispatcher: emits to connected sockets; for each other member who is not muted
     (a mention or a reply to them gets through a muted chat):
     - writes a notification-centre row and emits notification_created
     - queues a "notify" job: at once if they have no socket, after 8 s if they do
  worker "notify" job: re-checks (message deleted/expired? left? muted? quiet hours? already read?),
     then for each of the person's devices:
        device already has the message (delivery receipt) -> skip
        device inside its own quiet hours                -> skip
        otherwise web-push (urgency high, TTL 1 day); 404/410 -> disable that subscription
  service worker `push` event -> always shows a notification
  tap -> focus the open window or open /?c=<chat>&m=<msg>&s=<seq> -> the chat opens at the message
```

| Situation                                           | Centre row | Push                          |
| --------------------------------------------------- | ---------- | ----------------------------- |
| Offline member, chat not muted                      | yes        | yes, at once                  |
| Connected member (receipt arrives)                  | no         | no                            |
| Looks connected but app is frozen or closed         | yes        | yes, after 8 s                |
| Muted chat, plain message                           | no         | no                            |
| Muted chat, mention of you or reply to you          | yes        | yes                           |
| The sender and the sender's other devices           | no         | no                            |
| System, call-event messages, bots                   | no         | no                            |
| Account quiet hours (sender not a priority contact) | no         | no                            |
| Device inside its own quiet hours                   | yes        | no (that device)              |
| Device with Message previews off                    | yes        | yes, text "New message"       |
| Chat already read when the job runs                 | no         | no                            |
| No push subscription                                | yes        | no (logged `no_subscription`) |

Text: title is the sender (groups: "Sender in Group"); body is the first about 100 characters (markdown
marks such as `**` and `#` are stripped so it reads as plain text, also in the push body), or "Sent you a photo
/ a voice message / a video / a poll / a file". **Albums:** several photos and videos sent together make
**one** alert, for the first item ("4 photos", "3 photos and 2 videos"); the other items add no centre row and no
push, but still count as unread. Messages of one chat share a tag and
re-notify, so the shade shows one grouped entry. Calls have their own pushes (`call-push`).

A friendly **Turn on notifications so you never miss a message** card appears in the chat list once you
have a chat with a message. **Not now** hides it for a few days. Settings shows the browser
permission state and a **How to change** help dialog. **Send me a test notification** (`POST
/push/test`, 3 a minute, only to your own devices) shows, per device, sent, expired or failed.

## Quiet hours

There are two separate settings. Both say "quiet", so be clear which one you mean.

|            | Device quiet hours                                                        | Account quiet hours                                                            |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Setting    | "Quiet hours" with From and To (24 hour, can cross midnight)              | "Quiet hours (push and sounds)": on/off, From, To, days of the week, time zone |
| Stored     | This device (and sent to the server with this device's push subscription) | Server (`productivity_settings`), same on every device                         |
| Silences   | Sounds and desktop alerts here; push to this device                       | In-app sounds on any device; push to all devices                               |
| Calls      | Still ring                                                                | Not affected by the message rules                                              |
| Exceptions | none                                                                      | Messages from **priority contacts**                                            |

The account time zone starts as UTC; use the "Use this device's time zone" button under the quiet-hours fields so the hours mean
your local time. That field is only shown while account quiet hours are switched on, and the morning
briefing uses the same time zone. Code: `features/productivity/ProductivitySettings.tsx`, `quiet.ts`, worker
`jobs/notify.ts` (`inQuietHours`), `packages/contracts` (`isQuietNow`).

## Priority contacts

Settings > Notifications > **Priority contacts** lets you pick people (up to 50). Their messages come first in the
digest and are let through quiet hours. The picker saves to the device setting `priorityContacts` and also copies
the list to the server (`priority_contacts` in the productivity settings, `PUT /productivity/settings`, via
`syncPriorityContacts` in `features/productivity/quiet.ts`). The server's account quiet hours (push to all devices)
and the in-app quiet check both read that server list, so a priority contact now gets through. Status: Built.

## Keyword alerts (Partial)

Settings > Notifications > **Keyword alerts**: add up to 20 words. A text message containing one (not
case sensitive, part of a word counts) notifies you **even in a muted chat**. **Gap:** this is checked
only in the open app (banner, sound, desktop notification while the tab is hidden). The server push
does not know your keywords, so with Flick closed a plain message in a muted chat still sends no push.
Mentions and replies do get through on the server.

## Notification digest

Settings > Notifications, under the push switch: **Notification digest** Off, Every 1 h, Every 3 h,
Every 6 h. With it on, non-urgent desktop notifications are held back and sent as one line per chat,
for example "Maya: 3 new messages". Mentions, keyword alerts and urgent-sounding messages
("asap", three exclamation marks) still come straight through. The counts live in memory only, so
closing the tab loses them; the app says it is a convenience, not a guarantee. Code:
`notifications/digest.ts`.

## Morning briefing message

Settings > Notifications > **Briefing**: Off, Daily or Weekly (Monday). At 8 am in your account time
zone, the worker posts a message in your Flick chat: reminders coming up, chats waiting and the number
of saved items. Sent at most once per 20 hours (daily) or 6 days (weekly). No AI. Code:
`apps/worker/src/jobs/digest.ts`. The chat list also has a [briefing card](chat-list.md).

## Login alerts

Settings > Account > **Alert me about new sign-ins** (on by default). When your account signs in from a
new device, Flick posts a note from the Flick bot in your **Saved messages** ("New sign-in: your
account was signed in from <device>..."), which notifies you like any message. Skipped for your very
first device. Code: `apps/api/src/modules/platform/loginAlert.ts`; endpoints `GET/PUT
/users/me/login-alerts`.

## App badge and tab title

The total of unread messages shows in the browser tab title ("(3) Flick", "(99+) Flick") and, where
the browser supports the Badging API, on the installed app icon. Muted chats and snoozed chats are not
counted. Code: `notifications/unreadTotal.ts`.

## Desktop Reply

On Chrome and Edge on desktop, a message notification has a **Reply** box. There is no sign-in inside
the service worker, so the typed text is passed to the app, which opens the chat with that text
waiting in the message box for you to send. It is not sent automatically. Other browsers show the
notification without the Reply box.

## Platforms

- **iPhone and iPad:** push works only in the Home Screen app (iOS 16.4 or newer). In a Safari tab the
  app says to add Flick to the Home Screen first and opens the install guide.
- **Android (Chrome):** works in the browser and the installed app. Battery savers can delay pushes.
- **Desktop:** Chrome, Edge and Firefox work with the browser closed only if the browser process runs.
- Permission denied: the settings page and banner show the steps for your platform.

## Troubleshooting

1. Settings > Notifications > **Send me a test notification**.
   - "No subscription": turn the push switch on.
   - "accepted" but nothing shows: check system settings (Focus, battery saver, browser notifications).
   - "expired": open Flick on that device; it re-subscribes by itself.
   - "failed, status 401/403": the server's push keys changed; open Flick again.
2. The worker logs one `notify` line per attempt with a `result` (`sent`, `no_subscription`,
   `all_devices_skipped`, `push_failed`, `skipped_muted`, `skipped_seen`, `skipped_gone`). Quiet hours
   and muted chats both show as `skipped_muted`. Never endpoints or keys.
3. The Render free instance sleeps after about 15 minutes of no traffic; minute jobs (reminders,
   scheduled messages, briefings, purges) only run while it is awake. Use an uptime pinger on
   `/health/live`. The API also needs `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` for the test button.

Real delivery through FCM and Apple on physical Android and iOS phones cannot be verified from code.

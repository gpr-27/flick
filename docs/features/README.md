# Flick features: the complete catalog

This is the list of everything Flick can do today, in plain English. Each row has a one-line
description, an AI badge and a link to the page that explains it in detail. Flick is a chat app
(web, installable as an app) with messaging, groups, calls, a personal organiser and an optional
AI assistant. Everything in this list is built unless the Status column says Partial or Not built;
gaps are described honestly on the detail pages.

## Related

- [AI overview](../ai/README.md) and [where AI is used, feature by feature](../ai/feature-map.md)
- [Privacy and limits of the AI](../ai/privacy-and-limits.md)
- [Project status](../status.md), [architecture](../architecture/), [security](../security/auth.md)
- [Design system](../design/design-system.md), [testing](../testing.md)

## How to read the AI badge

| Badge       | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| AI          | The feature is the AI. It does nothing when AI is not set up on the server.                          |
| optional AI | The feature works without AI. One extra button or step uses AI, and only when you tap or switch it on. |
| no AI       | No AI at all. Plain code (rules, pattern matching, the database).                                    |

Detail for every AI touchpoint is in [docs/ai/feature-map.md](../ai/feature-map.md). In the detail
pages an "AI:" line marks the same places.

## How this documentation is organised

| Folder or file                              | What is in it                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `docs/features/` (this folder)              | What each feature does, how to use it, limits, files and endpoints, status |
| `docs/ai/`                                  | Every AI feature, the AI architecture, privacy, limits                     |
| `docs/architecture/`                        | How the system is built (API, worker, database, realtime protocol)         |
| `docs/decisions/`                           | Why we chose what we chose                                                 |
| `docs/security/auth.md`                     | Sign-in, sessions, devices                                                 |
| `docs/operations/` (`deployment`, `runbook`) | Running and fixing the app                                                |
| `docs/testing.md`, `docs/status.md`         | How it is tested, and what is done or open                                 |
| `docs/design/design-system.md`              | Colours, type, spacing, components                                         |

Each feature page starts with a one-paragraph summary and ends with a Related list. Status is
always one of Built, Partial or Not built.

## 1. Messaging and content

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Send, edit, delete, reply, react, forward | Normal chat actions on text messages | no AI | [messaging](messaging.md) |
| Message gestures | Swipe, long press and double tap on a message | no AI | [message-gestures](message-gestures.md) |
| Rich messages | Formatting, tables, code, polls, events, GIFs, stickers, link previews | optional AI | [rich-messages](rich-messages.md) |
| Photos, video, voice notes, files | Attach, camera, voice recorder, view-once, gallery | optional AI | [media-and-files](media-and-files.md) |
| Disappearing messages | Per chat timer (24 hours, 7 days, 90 days) and a default for new chats | no AI | [messaging](messaging.md), [settings](settings.md) |
| Scheduled messages | Send later, list, edit, cancel | no AI | [calendar-and-productivity](calendar-and-productivity.md) |
| Saved replies and slash commands | `/omw` style shortcuts, `/poll`, `/remind`, `/schedule`, `/flick` | no AI (`/flick` opens the AI) | [settings](settings.md), [messaging](messaging.md) |

## 2. Chat list and organising

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Chat list | Cards, filters (All, Unread, Favourites, Groups), archive, pin (max 3), mute durations, mark unread, swipe actions, row menu, select mode, delete for me | no AI | [chat-list](chat-list.md) |
| Phone and video icons on rows | One-tap call from a person-to-person row on phones | no AI | [chat-list](chat-list.md), [calls](calls.md) |
| Folders and tags | Group chats into folders, add coloured tags | no AI | [chat-list](chat-list.md) |
| Auto-sort suggestion | "Add this chat to Work?" from chat and folder names | no AI | [chat-list](chat-list.md) |
| Snooze a chat | Hide a chat until a chosen time (this device) | no AI | [chat-list](chat-list.md) |
| Needs-reply pill | Chats where the other person wrote last more than 2 hours ago | no AI | [chat-list](chat-list.md) |
| Morning briefing card | Due reminders and waiting chats at the top of the list | no AI | [chat-list](chat-list.md) |
| Catch-up card | "Catch me up on N unread" summary in a busy chat | AI | [chat-list](chat-list.md), [conversation-understanding](../ai/conversation-understanding.md) |
| Search (chat and global) | Messages and voice-note transcripts, with filters | optional AI (Ask Flick row) | [search-and-organise](search-and-organise.md) |
| Starred, pinned, bookmarks, notes, drafts | Your own marks on messages and unsent text | no AI | [search-and-organise](search-and-organise.md) |
| Chat lock and hidden vault | Hide a chat behind a passcode | no AI | [search-and-organise](search-and-organise.md), [safety-and-privacy](safety-and-privacy.md) |
| Wallpapers | 47 built-in in 7 categories, upload from gallery, dim slider | no AI | [search-and-organise](search-and-organise.md) |
| Per-chat colour and sound | Accent colour for your bubbles and a notification sound per chat | no AI | [search-and-organise](search-and-organise.md) |
| People directory and invite | Everyone on Flick A to Z, invite friends | no AI | [guide](guide.md), [profile](profile.md) |
| Call log | Missed, incoming, outgoing calls | no AI | [calls](calls.md) |

## 3. Time and productivity

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Reminders | Remind me about a message or a chat; Flick posts it in your Flick chat and pushes it | optional AI ("Let Flick pick the time") | [reminders](reminders.md) |
| Follow-up nudges | "You said you would... Remind me?" from your own sent messages | no AI | [reminders](reminders.md) |
| Calendar | Month view of reminders, scheduled messages and events, with edit and delete | no AI | [calendar-and-productivity](calendar-and-productivity.md) |
| Events with RSVP | An Event card in a chat with Going, Maybe, No | no AI | [calendar-and-productivity](calendar-and-productivity.md) |
| Saved messages tools | Ask your saved notes, auto-tag them, bookmarks collections | AI (with a rule-based tag fallback) | [calendar-and-productivity](calendar-and-productivity.md) |
| Meeting notes | Minutes and action items from a chat, saved to Saved messages | AI | [calendar-and-productivity](calendar-and-productivity.md) |
| Command palette and shortcuts | Ctrl/Cmd+K, `?` cheat sheet, `/`, Alt+N, Alt+Arrows | no AI | [calendar-and-productivity](calendar-and-productivity.md) |

## 4. Notifications and the installed app

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Notification centre | Bell, grouped by day, mark read, clear | no AI | [notifications](notifications.md) |
| Banners, sound, vibration | In-app banner and short sound for chats you are not looking at | no AI | [notifications](notifications.md) |
| Web push | Notifications when the app is closed | no AI | [notifications](notifications.md), [pwa-and-push](pwa-and-push.md) |
| Quiet hours and priority contacts | Silence alerts on a schedule | no AI | [notifications](notifications.md) |
| Keyword alerts | Words that break through mute (open app only) | no AI | [notifications](notifications.md) |
| Notification digest and morning briefing | Batched desktop alerts; daily or weekly briefing message | no AI | [notifications](notifications.md) |
| Login alerts | Note in Saved messages on a sign-in from a new device | no AI | [notifications](notifications.md), [settings](settings.md) |
| App badge and desktop reply | Unread count on the icon; Reply box on desktop notifications | no AI | [notifications](notifications.md) |
| Install as an app | Install button, install guide, app shortcuts, share target | no AI | [pwa-and-push](pwa-and-push.md) |
| Offline reading | Recent chats open from a device copy when the network is down | no AI | [pwa-and-push](pwa-and-push.md), [calls-offline](calls-offline.md) |

## 5. Groups

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Groups | Create, roles, invite link, join requests, group info, welcome text, slow mode | optional AI (group AI tools) | [groups](groups.md) |
| Incoming webhooks | A secret URL that posts text into a chat | no AI | [integrations](integrations.md) |

## 6. Calls

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Voice and video calls | One to one calls, screen sharing, call controls | no AI | [calls](calls.md) |
| Group calls and call links | Many people in one call, join by link | no AI | [calls](calls.md) |
| Live captions | Speech turned to subtitles in the browser | no AI (browser speech) | [calls](calls.md) |
| Calls on a weak network | Offline and reconnect behaviour | no AI | [calls-offline](calls-offline.md) |

## 7. Flick, the AI assistant

All AI is explained in [docs/ai/](../ai/README.md). The short list:

| Feature | AI badge | Detail |
| --- | --- | --- |
| Chat with Flick, memory, topics | AI | [flick-assistant](../ai/flick-assistant.md) |
| Writing help (rewrite, tone check, ghost text, my voice, personas, plans) | AI | [writing-assistant](../ai/writing-assistant.md) |
| Summaries, catch-up, ask a chat, suggest replies | AI | [conversation-understanding](../ai/conversation-understanding.md) |
| Describe an image, explain a file, voice dictation | AI | [files-images-voice](../ai/files-images-voice.md) |
| Translate, auto-translate, auto-transcribe | AI | [translation-and-transcription](../ai/translation-and-transcription.md) |
| Link check with AI, group AI tools | optional AI | [productivity-and-safety](../ai/productivity-and-safety.md) |
| AI usage, speed, privacy per chat, export and clear my AI data | n/a (controls) | [privacy-and-limits](../ai/privacy-and-limits.md), [settings](settings.md) |

## 8. Account, safety and settings

| Feature | What it does | AI badge | Detail |
| --- | --- | --- | --- |
| Profile | Name, username, About (139 characters), photo with crop, QR code, share link | optional AI (write my bio) | [profile](profile.md) |
| Settings | Account, Notifications, Appearance, Chats, Calls, Privacy, Flick assistant, Guide, Storage, About | optional AI (the AI section) | [settings](settings.md) |
| Appearance | Theme, accent, fonts (serif default), text size, density, corners | no AI | [appearance-and-accessibility](appearance-and-accessibility.md) |
| Accessibility | Reduce motion, high contrast, dyslexia-friendly text, focus rings, keyboard use | no AI | [appearance-and-accessibility](appearance-and-accessibility.md) |
| Privacy settings | Last seen, photo, About, who can add me to groups, read receipts | no AI | [safety-and-privacy](safety-and-privacy.md) |
| Block and report | Block a person, report a person or message | no AI | [safety-and-privacy](safety-and-privacy.md) |
| App lock | PIN to open the app, with a "require after" timeout | no AI | [safety-and-privacy](safety-and-privacy.md) |
| Link safety, scam and look-alike banners | Warnings from simple rules; optional AI link check | no AI (optional AI check) | [safety-and-privacy](safety-and-privacy.md) |
| Passkeys, signed-in devices | Add passkeys, sign out other devices | no AI | [settings](settings.md), [integrations](integrations.md) |
| Data export and account deletion | Download all your data; delete the account | no AI | [settings](settings.md) |
| Storage manager | Media per chat, free up space, clear cache, auto-download rule | no AI | [settings](settings.md) |
| Feature guide and tour | Welcome tour (10 steps) and tips | no AI | [guide](guide.md) |
| Email to chat | Mail to your username lands in Saved messages | no AI | [integrations](integrations.md) (Partial) |

## Known gaps worth knowing

These are described in detail on the pages linked. None of them stops the app working.

- Priority contacts picker does not reach the server's quiet hours ([notifications](notifications.md)).
- Calendar has no button on laptops, only the command palette or the address `/calendar` ([calendar-and-productivity](calendar-and-productivity.md)).
- Email to chat works only if the operator sets it up, and the app does not show the address ([integrations](integrations.md)).
- Keyword alerts work only while Flick is open ([notifications](notifications.md)).
- Chat lock is a convenience lock, not encryption ([safety-and-privacy](safety-and-privacy.md)).

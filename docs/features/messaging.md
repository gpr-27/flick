# Messaging

This page is the day-to-day of a chat: writing and sending text, replying, editing, deleting, reacting, forwarding, starring, pinning, mentioning, using slash commands and saved replies, drafts, scheduled messages, disappearing messages, notes, bookmarks, message info and chat export. Photos, files and voice notes are in [media-and-files.md](media-and-files.md); polls, events, locations, contact cards and the other special message types are in [rich-messages.md](rich-messages.md). Code: `apps/web/src/features/chat` (and `organise`, `content`, `scheduled`, `exporting`) and `apps/api/src/modules/{messages,drafts,notes,scheduled,reminders}`.

Related: [rich-messages.md](rich-messages.md) | [media-and-files.md](media-and-files.md) | [message-gestures.md](message-gestures.md) | [groups.md](groups.md) | [search-and-organise.md](search-and-organise.md) | [chat-list.md](chat-list.md) | [notifications.md](notifications.md) | [reminders.md](reminders.md) | [calendar-and-productivity.md](calendar-and-productivity.md) | [settings.md](settings.md) | [../ai/README.md](../ai/README.md) | [../ai/writing-assistant.md](../ai/writing-assistant.md) | [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md)

## Limits

| What                      | Limit                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Text message              | 65,000 characters (`LIMITS.MAX_TEXT_LENGTH`); the box shows a counter when you are within 10 percent of it |
| Caption                   | 16,000 characters (`LIMITS.MAX_CAPTION_LENGTH`)                                                            |
| One message's JSON        | 400 KB (a max-length text fits, even with escaped characters)                                              |
| Mentions per message      | 256 user ids                                                                                               |
| Scheduled message         | text only, 1 minute to 1 year ahead, 50 waiting per user                                                   |
| Private note on a message | 1,000 characters                                                                                           |
| Reply target              | must be a message in the same chat                                                                         |

## Sending text

**What it does.** Sends a text message. The message is saved in the browser first (IndexedDB outbox), shown at once with a clock, then confirmed by the server. If the connection is down it waits and is sent when you are back online and synced; a reload or crash loses nothing. Every resend uses the same `client_message_id`, so a retry can never create a duplicate.

**How to use it.** Type in the box and press Send. Settings, Chats, "Enter sends" decides the keys: on, Enter sends and Shift+Enter is a new line; off, Enter is a new line and Ctrl or Cmd+Enter sends. Exactly what you typed is sent (line breaks, indentation), minus empty lines at the start and spaces at the end. Status marks under your messages: clock (sending), single tick (sent), double tick (delivered), blue double tick (read), red "Not sent" with Retry and Discard when it failed.

**Long messages.** A message over 600 characters or 12 lines is shown collapsed with a "Read more" button ("Show less" to fold it again), so a 65,000-character message costs almost nothing to draw.

**Status: Built.**
Gap: only text can wait offline. A photo or file must be uploaded first, so it needs a connection.

AI: while you type, optional helpers can work in the box: suggested replies, a tone check, "suggest as I type" ghost text, polishing a selection, and "send in another language". See "AI in the composer" below.

## Formatting, emoji, links

- **Formatting toolbar** (the "Formatting" button): bold, italic, strikethrough, code, code block, heading, quote, lists, link and table, written as markdown around the selection. Ctrl or Cmd with B, I or E work as shortcuts. Messages are shown with their markdown formatting.
- **Paste a table** from a spreadsheet: it becomes a markdown table on its own lines, with an Undo chip to get the plain text back.
- **Emoji picker** with search and a "recent" row (the last 16, remembered on this device). Typing a shortcode like `:smile:` shows a suggestion list above the box.
- **Link preview.** The first link in a text shows a preview card under the message (and a preview in the composer while typing). The sender can turn it off for one message; the reader can turn previews off in Settings.

**Status: Built.**

## Reply and quote jump

**What it does.** Replies quote the original above your message.

**How to use it.** Open the message menu and choose Reply, use the reply button that shows beside the time on hover or focus, or swipe the message to the right on a touch screen (see [message-gestures.md](message-gestures.md)). The box shows "Replying to ..." with a close button. Tapping the quote in a bubble scrolls to the original and flashes it.

**Status: Built.**
Gap: the quote shows a short preview; very old originals that are not loaded in the thread show a generic "Message".

## Edit, edit history, delete

**Edit.** Menu, "Edit" on your own text, photo and file messages (for a photo or file you edit the caption). The box loads the text; pressing ArrowUp in an empty box edits your last text message. Edited messages show an italic "edited" label, and "Edit history" in the menu lists the earlier versions (oldest first, from `GET /conversations/:id/messages/:id/edits`; each edit stores the old text in `message_edits`). Only the text or caption can change, never the media. The server allows editing video and GIF captions too, but the app offers Edit only for text, photo and file messages.

Edit window: there is none. You can edit your own message at any time. (The error code `EDIT_WINDOW_EXPIRED` is still listed in the shared error table, but nothing in the API uses it and the old 15 minute constant was removed.) The live-location feature has a fallback for a refused edit and posts a fresh message in that case (see [rich-messages.md](rich-messages.md)); today no edit is refused.

**Delete.** Menu, "Delete" gives "Delete for me" (hides it on your devices only) and "Delete for everyone" (offered on your own messages; the API also lets a group admin delete anyone's message, which the flagged list uses). A message deleted for everyone stays as a tombstone, "This message was deleted", with its content removed so message numbers have no holes. Deleting a pinned message removes the pin.

**Status: Built.**
Gap: edits and "Delete for everyone" have no time limit.

## Reactions

Eight quick reactions (thumbs up, heart, laugh, surprised, sad, pray, fire, party) in the message menu. One reaction per person per message: picking another emoji replaces yours, picking the same one again does nothing, and tapping your own chip under the message removes it. Double tap or double click on a message adds a heart (see [message-gestures.md](message-gestures.md)).

**Status: Built.**
Gap: the picker offers 8 emoji; there is no full emoji reaction picker.

## Forward

Menu, "Forward" opens a chat picker (several chats at once; "Send (N)"). Forwarded copies are marked "Forwarded". Only text, photos, videos, files, voice notes, GIFs and stickers can be forwarded; polls, events, checklists, expenses, games, system lines and call lines cannot, and neither can view-once messages. The reply link, mentions and view-once flag are dropped from the copy. In multi-select mode several messages can be forwarded together.

**Status: Built.**

## Star, pin, bookmark, remind, note

| Action    | Where                | What it does                                                                                                                                                                                                                        |
| --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Star      | Menu, Star or Unstar | Private to you. Starred messages are listed in the starred panel and can be searched. `POST/DELETE .../star`, `GET /messages/starred`.                                                                                              |
| Pin       | Menu, Pin or Unpin   | Any member can pin; the pinned message shows in a bar at the top of the chat for everyone in the chat, newest first. No limit in the code on how many messages can be pinned. (Pinning a chat in the chat list is separate, max 3.) |
| Bookmark  | Menu, "Bookmark..."  | Saves the message into a named collection of your own. See [calendar-and-productivity.md](calendar-and-productivity.md).                                                                                                            |
| Remind me | Menu, "Remind me"    | Later today, tomorrow, next week, custom, or let Flick read the time from the message. See [reminders.md](reminders.md).                                                                                                            |
| Add note  | Menu, "Add note"     | A private note under the message that only you ever receive (1 to 1,000 characters). `PUT/DELETE/GET /conversations/:id/notes`. Shown as a chip under the message.                                                                  |

**Status: Built.**

AI: "Remind me" can let Flick read the time from the message text. See [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md).

## Mentions

Type `@` and a name: a list of members appears (arrow keys and Enter, or tap). The message keeps plain `@username` text and also carries the user ids (`mentions`), so mentioned people are highlighted and get a notification even if the chat is muted. In a group, `@everyone` is offered at the top of the list and mentions the members (their ids are loaded when `@everyone` appears in the text).

**Status: Partial.**
Gap: `@everyone` fetches at most the first 100 non-bot members (`mentionCandidates` with limit 100), and a message can carry at most 256 mentions, so in a group larger than 100 members not everyone is notified.

AI: `@flick` addresses the assistant. See [../ai/flick-assistant.md](../ai/flick-assistant.md).

## Slash commands and saved replies

Type `/` as the first thing in the box: a list shows the matching commands.

| Command          | Does                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/poll`          | Opens the poll composer (see [rich-messages.md](rich-messages.md)).                                                                                     |
| `/remind text`   | Opens the reminder dialog with `text` filled in.                                                                                                        |
| `/schedule text` | Opens the schedule dialog with `text` filled in.                                                                                                        |
| `/flick text`    | Turns into `@flick ` and addresses the AI assistant; in a person-to-person chat it opens the "Write with Flick" bar instead of sending the instruction. |

**Saved replies.** You define a shortcut and a text (for example `omw`); typing `/omw` shows it in the same list, and choosing it puts the text in the box. Shortcuts are lowercase letters and digits; `poll`, `remind`, `schedule` and `flick` are reserved. You manage them in Settings, Chats (saved replies editor). They are kept in this browser's localStorage only.

**Status: Built.**
Gap: saved replies are not synced across devices (only drafts are).

AI: `/flick` and the "Write with Flick" bar use the writing assistant. See [../ai/writing-assistant.md](../ai/writing-assistant.md).

## Drafts

The text you have not sent is kept per chat: in memory and (if "Save drafts on this device" is on in Settings, Storage) in localStorage, and a second copy is saved to the server about one second after you stop typing (`PUT /conversations/:id/draft`, up to 65,000 characters). When you open a chat on another device, the server draft is loaded if it is newer than what that device has. Clearing the box deletes the server draft.

**Status: Built.**
Gap: drafts are text only; an attached file is not part of the draft.

## Scheduled messages

**What it does.** Sends a text message later, from the server, even if your browser is closed.

**How to use it.** Plus or tools menu, "Schedule send" (or `/schedule`). Pick a preset (In 1 hour, Tomorrow 09:00) or a date and time. The "Scheduled" list shows your waiting messages; you can edit the text or the time, or cancel one. A message that could not be sent shows "Not sent: reason" and stays in the list.

Rules: text only (up to 65,000 characters), at least 60 seconds and at most one year ahead, at most 50 waiting per user. The worker checks once a minute, so the send can be up to a minute late. `POST/GET /scheduled`, `PATCH/DELETE /scheduled/:id`.

**Status: Built.**
Gap: no scheduled photos, files, polls or voice notes; no recurring messages.

## Disappearing messages and view once

**Disappearing.** In a chat, the timer menu (24 hours, 7 days, 90 days, or Off) sets how long new messages live (`disappearing_timer_s`; in groups admins set it). Each new message gets an expiry time; the server never returns an expired message and the worker deletes them. A small timer icon shows on messages that will disappear. Changing the timer posts a system line in the chat. Already sent messages are not changed.

**View once.** For a photo, video or voice note, tick "view once" before sending. The receiver sees a cover; opening it shows the content once (the open is recorded by the server, `POST .../view-once/open`), then the message is "Opened" and the server stops sending the content to that person. While it is open, the content is blurred whenever the tab is hidden or the window loses focus. The sender cannot open their own view-once message. Forwarding a view-once message is not allowed.

**Status: Built.**
Gap: view-once and the blur are a deterrent, not protection. Anyone can still photograph the screen or use a screenshot tool, and the app cannot block screenshots.

## Message info

Menu, "Message info" on your own messages: lists who has received it (Delivered) and who has read it (Read), from `GET .../info`. Group chats show the lists by person.

**Status: Built.**

## Translate, explain, report

- **Translate** (menu, text messages): shows a translation under the message. Incoming text also gets a translate chip, and when the chat is set to auto-translate the translation shows under each incoming message with "Show original".
- **Send in <language>**: translates your draft before sending. Everyone reads the translation; you see your original on a small line and readers get "Show original".
- **Explain with Flick**: menu item for photos, files and voice notes.
- **Report**: menu item on other people's messages.
- **Read aloud**: menu item for text messages where the browser supports speech.

**Status: Built.**

AI: translate, auto-translate, send-in-language and explain are AI features; a small badge under incoming messages that look urgent or upset is a local keyword check (nothing leaves the device until you tap it). See [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md), [../ai/conversation-understanding.md](../ai/conversation-understanding.md) and [../ai/files-images-voice.md](../ai/files-images-voice.md). Report is in [safety-and-privacy.md](safety-and-privacy.md).

## Choosing several messages

Menu, "Select" (or hold a message). A bar replaces the header with Copy, Forward, Star and Delete for the chosen messages. Details in [message-gestures.md](message-gestures.md).

**Status: Built.**

## Chat export

**What it does.** Saves a chat to your device.

**How to use it.** Chat options, "Export chat...". Choose plain text (`.txt`, the default), JSON (`.json`), or a zip with the transcript and the attachments (`.zip`: `chat.txt` plus the files that could be downloaded; files that fail are skipped; stored without extra compression). The export reads history page by page in the browser, up to 200 pages of 100 messages (20,000 messages).

**Status: Built.**
Gap: chats longer than 20,000 messages are cut off at the newest 20,000; the zip depends on every file link working while it builds.

## Per-chat look and sound

Chat options, "Colour and sound...": an accent colour for your own bubbles and a notification sound for that chat (default, chime, pop or none). "Wallpaper..." in the same menu sets the chat background. These are kept on this device. See [appearance-and-accessibility.md](appearance-and-accessibility.md) and [notifications.md](notifications.md).

**Status: Built.**
Gap: look and sound are per device (localStorage), not synced.

## AI in the composer

All of these are off when AI is off for the account. Details and privacy rules are in the AI docs.

| Helper                                   | Where                                                  | Doc                                                                              |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Suggest replies (three chips)            | button above the box                                   | [../ai/conversation-understanding.md](../ai/conversation-understanding.md)       |
| Tone check before sending                | small note with a softer wording; never blocks sending | [../ai/writing-assistant.md](../ai/writing-assistant.md)                         |
| Suggest as I type (ghost text)           | optional, off by default                               | [../ai/writing-assistant.md](../ai/writing-assistant.md)                         |
| Polish or Rewrite a selection            | floating button on selected text                       | [../ai/writing-assistant.md](../ai/writing-assistant.md)                         |
| Describe your message / Write with Flick | `/flick`, the plus menu "Write with Flick"             | [../ai/writing-assistant.md](../ai/writing-assistant.md)                         |
| Send in another language                 | bar above the box                                      | [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md) |

## Delivery behind the scenes

Messages travel over a WebSocket with a REST fallback. Each conversation has dense sequence numbers, so a client that was offline asks for "everything after number N" and fills any gap (`sync`). Delivered and read marks are cursors per conversation. Slow mode, announcement-only groups and blocks are checked when sending (see [groups.md](groups.md) and [safety-and-privacy.md](safety-and-privacy.md)). The send path is `apps/api/src/modules/messages/domain/send.ts`.

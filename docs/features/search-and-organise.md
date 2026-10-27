# Search and organise

This page covers finding things (search inside a chat, search across all chats) and keeping things
tidy (starred messages, pinned messages, bookmarks, private notes, drafts, chat lock and the hidden
vault, wallpapers, per-chat colour and sound). Almost all of it is plain code. The AI touchpoints
are the optional "Ask Flick" row in search and the voice-note transcripts that search can read.

## Related

- [Chat list](chat-list.md): folders, tags, snooze, the list search box
- [Calendar and productivity](calendar-and-productivity.md): bookmarks page, saved messages tools
- [Safety and privacy](safety-and-privacy.md): chat lock and app lock in context
- [AI: conversation understanding](../ai/conversation-understanding.md) (Ask Flick),
  [AI: translation and transcription](../ai/translation-and-transcription.md) (transcripts)

## Search

Status: Built.

### Two ways in

| Where                                                    | Scope              | How to open                                        |
| -------------------------------------------------------- | ------------------ | -------------------------------------------------- |
| Search icon in the chat list header                      | All your chats     | Click it. Shortcut `/` focuses the list search box |
| Chat header search, or Chat options > **Search in chat** | The open chat only | Click it                                           |

Both open the same panel (`features/search/SearchPanel.tsx`). Type a word and press Search. Results
come in pages; use the load-more control to continue. Matching words are highlighted in the snippet.
Clicking a result opens the chat and jumps to that message (`organise/jump.ts`).

### Filters

| Filter             | Values                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Type               | Images, Video, Audio, Files, Links (one at a time; tap again to clear) |
| Starred            | Only messages you starred                                              |
| Pinned             | Only pinned messages                                                   |
| From person        | Anyone, or one person from your known people                           |
| From date, To date | A date range (the end date includes the whole day)                     |

Filters are sent to the server as query parameters (`sender_id`, `from`, `to`, `media`, `starred`,
`pinned`) on `GET /messages/search`. They reset when you close the panel.

### What is searched

- Message text, using the database full-text index (`messages.search`).
- Voice-note and audio **transcripts**, when a transcript exists (`message_transcripts.search`).
  AI: a transcript exists only if you transcribed the voice note, or switched on "Transcribe voice
  notes automatically" in Settings. Without a transcript the audio cannot be found by words. See
  [translation and transcription](../ai/translation-and-transcription.md).
- Messages you deleted for yourself or that a "delete chat" cleared are never returned.
- A hit in a **locked** chat stays hidden in the panel until that chat is unlocked in this tab.

### Search in the chat list box

The "Search chats" box under the header filters chats by name straight away. When you have typed at
least 2 characters it waits 300 ms and adds two more groups below the list: **People** on Flick (up to 5) and **Messages** (up to 5 hits). Tapping a message opens the chat at that message.

### Ask Flick row

AI, optional: when AI is set up and what you typed looks like a question, the first row of the
results is **Ask Flick: your question**. Tapping it asks Flick to answer from the top matching
messages and shows the answer with its sources. Nothing is sent until you tap. See
[conversation understanding](../ai/conversation-understanding.md). Code: `understand/AskFlickRow.tsx`.

## Starred messages

Status: Built.

Long-press or open a message menu and choose Star. The star icon in the chat list header (or the "⋮"
menu on phones) opens the **Starred** panel: your starred messages **grouped by chat**, with a filter
box that matches the message text or the chat name. Open one to jump to it. Stars are private to you.
Code: `organise/StarredPanel.tsx`, `groupStarred.ts`; API `POST/DELETE .../star`, `GET /starred`.

## Pinned messages

Status: Built.

Pin a message from its menu. A **pinned bar** under the chat header shows one pinned message at a
time and cycles through them; tapping the bar jumps to the message. Pins are shared with everyone in
the chat. Code: `organise/PinnedBar.tsx`, API `GET/POST/DELETE .../pins`.
(Pinned _chats_ are a different thing: see [chat list](chat-list.md), maximum 3.)

## Bookmarks

Status: Built, but hard to find.

Bookmark a message from its menu and pick or create a **collection** (name up to 40 characters).
The **Bookmarks** page (`/bookmarks`) shows saved messages grouped by collection with filter chips and
a remove button. The only visible link to it is in the opened Briefing card on the chat list. See
[calendar and productivity](calendar-and-productivity.md). Code: `productivity/BookmarksPage.tsx`.

## Private notes on messages

Status: Built.

Message menu > **Note** adds a private note (up to 1000 characters) to any message. Only you see it.
Notes load once per chat. Code: `features/notes/`, API `.../messages/:id/note`,
`.../conversations/:id/notes`.

## Drafts

Status: Built.

What you typed but did not send is kept per chat. The chat list row shows "Draft: ...".

- On this device in `localStorage`; Settings > Storage > "Keep drafts on this device" turns it off
  (then drafts live only while the page is open).
- On the server too (`/conversations/:id/draft`): saved about 1 second after you stop typing, and the
  newer copy wins when you open the chat on another device. Code: `organise/useServerDraft.ts`.

## Chat lock and hidden vault

Status: Built, as a convenience lock only.

- Chat options > **Lock chat...** asks for a passcode (at least 4 characters). The chat is hidden
  behind a lock screen until you type it. **Remove chat lock...** turns it off.
- The passcode is hashed in your browser (PBKDF2-SHA-256, 100,000 rounds, the chat id as salt) and
  only the hash is stored on the server. The server does not enforce the lock and the messages stay
  readable through the API, so this is **not encryption**. The app says so on the lock dialog.
- Unlocked chats are remembered for this browser tab only.
- **Hidden chats vault:** if you also have an [app lock PIN](safety-and-privacy.md), locked chats
  move out of the main list into a "Hidden chats" row that opens after the PIN. Without an app lock
  PIN they stay in the list.

Code: `organise/lock.ts`, `ChatLock.tsx`, `platform/HiddenChatsVault.tsx`, `platform/useVaultOn.ts`.

## Wallpapers

Status: Built.

Chat options > **Wallpaper...** opens a picker with a live preview.

| Part     | Detail                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in | **47** wallpapers in **7** categories: Minimal, Gradients, Aurora and mesh, Patterns, Nature, Dark and AMOLED, Seasonal. Drawn with CSS and tiny inline SVGs, no image files and no network                                              |
| Upload   | **Upload from gallery**: the picture is shrunk to at most 1600 px, stored in IndexedDB on **this device only**, up to 10 pictures. The chat stores just an id (`custom:<id>`), so on another device the chat shows the normal background |
| Dim      | **Dim wallpaper** slider, 0 to 60 percent in steps of 5, to keep bubbles readable. One value for all chats                                                                                                                               |
| Default  | Settings > Appearance > **Default chat wallpaper** applies to chats without their own                                                                                                                                                    |
| Per chat | The choice is a per-chat preference that is synced (`PATCH /conversations/:id/prefs`)                                                                                                                                                    |

Any picture the browser can decode works; HEIC only where the browser can read it. Code:
`organise/wallpapers.ts`, `customWallpapers.ts`, `WallpaperPicker.tsx`.

## Per-chat colour and sound

Status: Built, device only.

Chat options > **Colour and sound...** lets you pick, for one chat, an accent colour for your bubbles
(7 colours) and a notification sound: **Default, Chime, Pop, Silent**. A Test plays the sound. Both
are kept in `localStorage` on this device, not synced. Code: `organise/chatLook.ts`,
`ChatLookDialog.tsx`.

## Also in chat options

Remind me about this chat, Snooze chat, Export chat, and (when AI is set up) Summarise chat, Ask Flick
about this chat, Topics in this chat, Recap with Flick. See [reminders](reminders.md),
[chat list](chat-list.md) and the [AI docs](../ai/README.md).

## Limits and gaps

| Item                             | Status                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Search with filters, transcripts | Built                                                                                         |
| Search of locked chats           | Hidden until the chat is unlocked                                                             |
| Bookmarks page                   | Partial: no menu or navbar link; reachable from the Briefing card or the address `/bookmarks` |
| Custom wallpapers                | Built; device only, not synced                                                                |
| Per-chat colour and sound        | Built; device only, not synced                                                                |
| Chat lock                        | Built; not encryption                                                                         |

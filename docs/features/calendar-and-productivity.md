# Calendar and productivity

This page covers the calendar, scheduled messages, events with RSVP, the tools above the Saved
messages chat, meeting notes, bookmarks, the command palette and the keyboard shortcuts. Most of it is
plain code. The AI parts are clearly marked: asking and tagging your saved notes, and meeting notes.
Reminders have their own page: [reminders](reminders.md).

## Related

- [Reminders](reminders.md): quick remind, "let Flick pick the time", follow-up nudges
- [Chat list](chat-list.md): the briefing card and the "⋮" menu
- [Search and organise](search-and-organise.md): bookmarks, notes, stars
- [Settings](settings.md): saved replies, the shortcut list in About
- [AI: productivity and safety](../ai/productivity-and-safety.md)

## Calendar

Status: Built. Gap: no button on laptops.

A **month view** at `/calendar`. Each day shows small dots: a warning-coloured dot for a reminder, an
info-coloured dot for a scheduled message. Previous and next month buttons move around. Tap a day to
see its items below the grid.

| Item on the day   | Source                                      | Edit                                                                                                                  | Delete                |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Reminder          | Your waiting reminders                      | Change the note and time. There is no edit call for reminders, so the app creates the new one and cancels the old one | Cancels the reminder  |
| Scheduled message | Your waiting scheduled messages             | Change the text and the send time (`PATCH /scheduled/:id`)                                                            | Cancels it            |
| Event             | Event cards from your chats (`GET /events`) | Read only. Tapping opens the chat                                                                                     | Not from the calendar |

Where to find it: on phones, chat list "⋮" menu > **Calendar**. On laptops there is no header button;
use the command palette (Ctrl/Cmd+K, type "Calendar") or go to `/calendar`. Code:
`features/calendar/` (`CalendarPage.tsx`, `CalendarEvents.tsx`, `month.ts`).

## Scheduled messages

Status: Built.

Send a message later. In the composer use the schedule option or type `/schedule`.

- Quick choices: **In 1 hour**, **Tomorrow 09:00**, or pick a date and time.
- The time must be at least 1 minute and at most 1 year ahead. At most 50 waiting scheduled messages
  per person (`LIMITS.MAX_SCHEDULED_PER_USER`).
- The **Scheduled** list (calendar-clock icon in the chat list header, or the "⋮" menu on phones)
  shows what is waiting with **Edit** (text and send time) and **Cancel**.
- A worker job sends due messages once a minute (`apps/worker/src/jobs/send-scheduled.ts`), so a
  message can arrive up to about a minute late. On the free Render tier the worker sleeps when idle;
  see [operations](../operations/runbook.md).

Code: `features/scheduled/`, `apps/api/src/modules/scheduled/`. Endpoints: `POST
/conversations/:id/scheduled`, `GET /scheduled`, `PATCH` and `DELETE /scheduled/:id`.

## Events with RSVP

Status: Built.

Chat options > **Create event...** takes a title (up to 100 characters), a date and time and an
optional place (up to 200 characters), and posts an **Event card** in the chat. Everyone can answer
**Going, Maybe or No**; the card shows the counts and your answer. Events from all your chats appear
on the calendar day they start. Code: `productivity/EventCard.tsx`, `ChatProductivityItems.tsx`;
endpoints `POST /events`, `GET /events`, `PUT` and `GET /events/:message_id/rsvp`.

## Meeting notes

Status: Built. AI: needs AI on the server.

Chat options > **Make meeting notes** reads the latest 50 messages of the chat and asks Flick for a
short "Minutes" paragraph and "Action items" with owners when known. The result is saved to your
Saved messages and a toast says so. Chat text is treated as untrusted data in the prompt. Endpoint
`POST /productivity/meeting-notes`. See [productivity and safety](../ai/productivity-and-safety.md).

## Saved messages tools

Status: Built. AI: shown only when AI is set up.

Above the Saved messages chat (your private notes-to-self chat) there are three tools
(`productivity/SavedTools.tsx`).

| Tool               | What it does                                                                                                                                                                                | Endpoint                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Ask Saved messages | Answers a question from your latest 300 saved notes and lists the notes it used (up to 8)                                                                                                   | `POST /productivity/ask-saved` |
| Tag all            | Gives untagged saved notes a tag: note, link, task, idea or receipt. The AI picks; simple word rules (links, money words, to-do words) are the server fallback when the AI is not available | `POST /productivity/tag-saved` |
| Tag filter         | Shows the notes with one tag                                                                                                                                                                | `GET /productivity/tags`       |

## Bookmarks

Status: Built (see the gap in [search and organise](search-and-organise.md)). No AI.

Bookmark any message into a named collection. The `/bookmarks` page lists them by collection, with a
remove button. Endpoints: `GET/POST /bookmarks/collections`, `GET/POST /bookmarks`, `DELETE
/bookmarks/:collection_id/:message_id`.

## Command palette and keyboard shortcuts

Status: Built. No AI.

**Ctrl/Cmd+K** opens the command palette (`features/palette/GlobalKeys.tsx`). Type to filter with a
simple fuzzy match; the top 8 results show. Arrow keys move, Enter runs, Escape closes. It offers:
People, Settings, Calendar, Profile, Toggle theme, and **every one of your chats** by name.

Press **?** (when you are not typing) for the **cheat sheet**: the same list as Settings > Shortcuts
and about.

| Keys                         | Does                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| Enter                        | Send the message (or Ctrl/Cmd+Enter, see Settings > Chats "Enter sends") |
| Ctrl/Cmd + Enter             | Send in either mode                                                      |
| Arrow Up (empty message box) | Edit your last message                                                   |
| Esc                          | Cancel a reply or edit, close a dialog or menu                           |
| Arrow Up/Down, then Enter    | Pick a name from the @mention list                                       |
| Arrow keys, Enter            | Move around and pick in the emoji grid                                   |
| Tab                          | Move between controls; the first one skips to the content                |
| Ctrl/Cmd + K                 | Open the command palette                                                 |
| ?                            | Show the cheat sheet                                                     |
| /                            | Focus the chat search box                                                |
| Alt + N                      | Start a new chat                                                         |
| Alt + Arrow Up/Down          | Go to the previous or next chat (in order of latest message)             |

Plain-key shortcuts (`?` and `/`) are ignored while you type in a field. Code:
`features/settings/shortcuts.ts` (the single list) and `palette/fuzzy.ts`.

## Limits and gaps

| Item                                     | Status                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| Calendar month view with edit and delete | Built; no laptop button                                     |
| Scheduled messages                       | Built; up to 50, 1 minute to 1 year ahead                   |
| Events and RSVP                          | Built; events cannot be edited or deleted from the calendar |
| Meeting notes, Ask Saved, Tag all        | Built; need AI                                              |
| Command palette                          | Built; searches pages and chat names, not message text      |

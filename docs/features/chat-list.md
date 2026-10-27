# Chat list

The chat list is the home screen. Each chat is a rounded card with quick actions: swipe, a row
menu, filters, folders and tags, and a few helpers that tell you who is waiting for an answer. Most
of it is plain code. The only AI on this screen is the optional "Catch me up" card and the "Ask
Flick" row in search. Status: Built, with small gaps listed at the end.

## Related

- [Search and organise](search-and-organise.md): searching, stars, pins, wallpapers, lock
- [Notifications](notifications.md): mute, badge, briefing
- [Calendar and productivity](calendar-and-productivity.md), [Reminders](reminders.md)
- [Calls](calls.md): the phone icons on rows
- [AI: conversation understanding](../ai/conversation-understanding.md)

## What a row shows

Avatar, name and time. The last message with an icon (photo, video, voice note, poll, file, GIF).
The unread badge, pin, mute and favourite icons, an "@" when you were mentioned, and "Draft: ..." in
the accent colour when you have unsent text. "Mark as unread" shows a dot until you open the chat.
Rows are at least 64px high. Code: `apps/web/src/features/chat/components/Sidebar.tsx`,
`apps/web/src/features/chatlist/ChatRow.tsx`.

## Header buttons

| Button              | What it does                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Search              | Opens message search (see [search](search-and-organise.md))                                                |
| Starred             | Opens your starred messages (laptop; on phones it is in the "⋮" menu)                                      |
| Scheduled           | Lists messages waiting to be sent                                                                          |
| Reminders           | Lists your reminders                                                                                       |
| New chat, New group | Start a chat or a group                                                                                    |
| "⋮" menu            | Select chats, Mark all as read. On phones it also holds Starred, Scheduled, Reminders, Calendar, New group |

There is also a "Search chats" box under the header. It filters the list by chat name as you type.

## Filters

Four tabs: **All**, **Unread**, **Favourites**, **Groups**. Archived chats are never in these tabs;
they have their own entry. Order: pinned chats first, then latest activity. Code:
`features/organise/chatFilters.ts`.

| Extra filter           | Shows                                                | Rule                                         |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Folder or tag chip     | Only chats in that folder or tag. Tap again to clear | Chips appear once you have made at least one |
| "Needs reply · N" pill | Chats waiting on you                                 | See below                                    |

## Pinned, favourite, archive

- **Pin**: at most 3 chats. A fourth pin is refused by the server ("You can pin at most 3 chats").
  The Flick assistant chat cannot be pinned or archived.
- **Favourite**: Chat options > "Add to favourites" marks a chat for the Favourites tab (a per-chat preference).
- **Archive**: swipe or menu. A toast offers Undo. The "Archived" entry at the top of the list shows
  the count and opens the archived chats. A new message keeps a chat archived when Settings >
  Chats > "Keep archived chats archived" is on (the default). Otherwise the chat comes back.

## Mute durations

Chat options > **Mute...** offers **1 hour, 8 hours, 1 week, Always**. "Always" stores a date in
the year 2100. A muted chat sends no sound or push, except for a mention of you, a reply to you or
one of your [keyword alerts](notifications.md). Muted chats do not count in the unread badge.
Code: `organise/prefs.ts`.

## Swipe actions

| Gesture     | Buttons                      | Long swipe (past about 55% of the row) |
| ----------- | ---------------------------- | -------------------------------------- |
| Swipe right | Read/Unread, Pin/Unpin       | Pin                                    |
| Swipe left  | Mute/Unmute, Archive, Delete | Archive (with an Undo toast)           |

A short swipe leaves the row open until you tap elsewhere, scroll, press Escape or open another row.
The direction is decided after 8px and vertical scrolling is never blocked. A long swipe vibrates
for 10ms where the device allows. With reduced motion nothing animates but everything still works.
Holding a row on a touch screen starts select mode. Code: `chatlist/swipeGesture.ts`,
`useSwipeRow.ts`, `useOpenRow.ts`.

## Row menu (keyboard and screen readers)

Open it with the "⋮" on hover, a right-click, the context-menu key or Shift+F10. It holds every swipe
action plus **Select**: Mark as read/unread, Pin chat, Mute..., Archive chat, Delete chat (or
Clear chat). Saved messages only has Clear chat. The Flick chat has Mark as read, Mute and Clear.
Arrow keys move through the menu and Escape closes it. Buttons carry names like "Archive chat with
Bob". Code: `chatlist/RowMenu.tsx`, `rowActions.ts`.

## Mark as unread and Mark all as read

Mark as unread sets a per-member preference (`prefs.marked_unread`, synced). It counts in the Unread
tab and clears when you open the chat. "Mark all as read" is in the list's "⋮" menu and tells you
when there was nothing to mark.

## Select mode

Start it from a long press, the row menu ("Select") or the list menu ("Select chats"). A bar shows
the count, Select all/none, and buttons for read/unread, pin, mute, archive and delete. Escape or
the X leaves it. Changing tab or view also ends it.

## Phone and video icons on rows

On phones, a person-to-person row has two small buttons at its end: a voice call and a video call.
They are not shown for the Flick assistant, Saved messages, hidden chats, or while selecting, and
they are disabled while another call is in progress. They are for pointer users only (the same calls
are in the chat header), so they are out of the tab order. Code: `ChatRow.tsx`.

## Folders and tags

Chat options > **Folders and tags...** opens a dialog.

- Make a **folder** or a **tag** (name 1 to 30 characters). Tags get one of 6 colours.
- Tick the folders and tags this chat belongs to. You can delete a folder or tag from the same dialog.
- Folders and tags appear as chips under the filter tabs. Tap a chip to filter, tap again to clear.
- Stored on the server (`/chat-lists`), so they follow you to other devices. Up to 500 chats per
  folder.

Code: `features/lists/`, API `GET/POST/PATCH/DELETE /chat-lists`.

## Auto-sort suggestion

In a chat that is in no folder or tag, a line above the composer says "Add this chat to Work?" with
**Add** and **No thanks**. The guess is a local rule, not AI: if a folder's name (3 or more
characters) appears in the chat title or last message, it suggests that folder. Otherwise a group
is matched to a folder named like group, team, work or family, and a direct chat to one named like
friend, personal or people. "No thanks" is remembered per chat on this device. Code:
`lists/sortRules.ts`, `lists/SortSuggestion.tsx`.

## Snooze

Chat options > **Snooze chat...**: 1 hour, 3 hours, Tomorrow morning (9:00), Next week (9:00 on the
next Monday). A snoozed chat leaves the list and stops counting in the unread badge
until the time passes, except while it is the open chat. **Unsnooze** is in the same dialog. Snooze
is kept on this device only. Code: `understand/snooze.ts`, `SnoozeDialog.tsx`.

## Needs-reply pill

A chat counts as "needs reply" when its last message is from the other person and is older than
2 hours. Not counted: Saved messages, archived chats, snoozed chats, chats whose last message is
yours. The pill shows the count; tapping it filters the list. No AI. Code:
`understand/heuristics.ts` (`needsReply`).

## Briefing card

A collapsible card at the top of the list: "Your briefing: N reminders, M chats waiting". Opened, it
lists reminders due in the next 24 hours (up to 10), up to 5 chats with unread messages, the count of
saved items and a link to Bookmarks. It is collapsed by default (the choice is remembered on this
device) and hidden when both lists are empty. It is built from the database with no AI
(`GET /productivity/digest`, the `summary` field is always empty). The same briefing can also be
posted in your Flick chat each morning: see [notifications](notifications.md).

## Catch-up card

AI: in a chat with 8 or more unread messages, and only when AI is set up, a card above the composer
offers **Catch me up on N unread**. It asks Flick for a summary and shows counts such as "3
decisions, 2 questions for you, 1 deadline", with the items listed. **Hide** dismisses it. Nothing is
sent to the AI until you tap. See [conversation understanding](../ai/conversation-understanding.md).
Code: `understand/CatchUpCard.tsx`.

## Urgent and upset hints

Messages that look urgent ("asap", three exclamation marks) or upset (angry words, shouting in
capitals) get a small local hint. These are word rules in `understand/heuristics.ts`. The AI is only
asked if you tap.

## Delete chat (for me)

`DELETE /conversations/:id` after a confirmation ("Delete this chat? Your copy of the messages is
removed from this device and your account; the other people keep theirs.").

- Stored per member: `cleared_seq` and `deleted_at` (migration `0015_chat_list`). History, search,
  shared media, pins, stars, AI context, sync and data export all skip messages up to `cleared_seq`.
- A direct chat leaves the list. A newer message brings it back, showing only newer messages.
- Groups: the server answers 409 ("Leave the group first"). The dialog says "Leave and delete".
- Flick chat and Saved messages: the action is "Clear chat". The history is cleared and the chat
  stays.

## Limits and gaps

| Item                                               | Status                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Filters, pin, archive, mute, swipe, select, delete | Built                                                                                                                                     |
| Folders and tags                                   | Built                                                                                                                                     |
| Snooze                                             | Built, but kept on one device only (not synced)                                                                                           |
| Needs-reply, auto-sort suggestion, briefing        | Built (rule based, no AI)                                                                                                                 |
| Catch-up card                                      | Built; needs AI on the server and 8 or more unread                                                                                        |
| Calendar button                                    | Partial: on laptops there is no header button for Calendar, only the palette (Ctrl/Cmd+K) or `/calendar`. On phones it is in the "⋮" menu |

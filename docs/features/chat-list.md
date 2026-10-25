# Chat list

The list works like WhatsApp: each chat is a rounded card, with quick actions straight from the
list.

## Cards

Avatar, name and time, the last message with an icon (photo, video, voice note, poll, file, GIF),
the unread badge, pin / mute / favourite icons, an "@" when you were mentioned, and
"Draft: ..." in the accent colour when there is unsent text. "Mark as unread" shows a dot until
the chat is opened. The selected chat is highlighted. Rows are at least 64px high.

## Swipe

| Gesture | Buttons                      | Long swipe (past ~55% of the row) |
| ------- | ---------------------------- | --------------------------------- |
| Right   | Read/Unread, Pin/Unpin       | Pin                               |
| Left    | Mute/Unmute, Archive, Delete | Archive (with an Undo toast)      |

A short swipe leaves the row open until you tap elsewhere, scroll, press Escape or open another
row (only one is open at a time). Direction is decided after 8px; the row has
`touch-action: pan-y`, so vertical scrolling is never blocked. A long swipe vibrates for 10ms
where the device supports it. With reduced motion (system or the app setting) nothing animates
but everything still works. Code: `apps/web/src/features/chatlist/swipeGesture.ts` (pure maths,
tested), `useSwipeRow.ts` (pointer events), `useOpenRow.ts`.

Holding a row on a touch screen starts select mode (the swipe and the hold do not fight: moving
more than a few pixels cancels the hold).

## Keyboard and screen readers

The buttons behind the card and the hover "⋮" are for pointer users only (a button inside a
listbox option would be a nested control). Every action is in the row menu, opened with the
context-menu key, Shift+F10, a right-click or the "⋮" on hover: Mark as read/unread, Pin, Mute,
Archive, Delete (or Clear chat), Select. Delete on a focused row asks to delete it. Menu and
swipe buttons carry names like "Archive chat with Bob".

## Archive

The "Archived" entry sits at the top of the list with the count and opens the archived chats in
the same list. A new message keeps a chat archived when Settings > "Keep archived chats archived"
is on; otherwise the chat comes back.

## Delete chat (for me)

`DELETE /conversations/:id` after a confirmation ("Delete this chat? Your copy of the messages is
removed from this device and your account; the other people keep theirs.").

- Stored per member: `cleared_seq` (last seq at deletion), `deleted_at`, in migration
  `0015_chat_list`. The shared SQL condition `visibleTo` (history, search, shared media, pins,
  stars, AI context), the sync, the chat summaries (last message) and the data export all skip
  `seq <= cleared_seq`.
- A direct chat leaves the list; a newer message brings it back showing only newer messages.
  Sync reports a deleted chat as removed so other devices drop it.
- Other members are unaffected; a non-member gets 404.
- Groups: the server answers 409 ("Leave the group first"). The dialog says "Leave and delete"
  and the app calls leave, then removes the chat.
- Flick chat and Saved messages: the action is "Clear chat". The history is cleared and the chat
  stays.

## Mark as unread

`prefs.marked_unread` (per member, synced). It counts as unread in the Unread tab and is cleared
when the chat is opened or marked read.

## Select mode

From a long press, the row menu ("Select") or the list menu ("Select chats"). A bar shows the
count, Select all/none, and buttons for read/unread, pin, mute (always / unmute), archive and
delete. Escape or the X leaves it.

# Flick message gestures

Code: `apps/web/src/features/chat/gestures/` and `apps/web/src/features/chat/selection/`. The bubble
(`components/MessageBubble.tsx`) only wires them in; the rules live in small files of their own.

## What a person can do

| Gesture                                          | Where              | Result                                                                                                                            |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Drag a message to the right, let go past 48 px   | touch screens      | Reply (the same as the menu's Reply: the composer shows "Replying to ..." and takes focus), with a light buzz where the phone can |
| Double tap / double click a message              | touch / mouse      | Adds a heart reaction; again removes it. A small heart pops over the message                                                      |
| Hold a link                                      | touch              | A sheet with "Copy link" and "Open" instead of the whole message menu                                                             |
| Hold a message, or right-click it, then "Select" | everywhere         | Choose several messages (see below)                                                                                               |
| Drag the actions sheet down                      | touch              | Closes it                                                                                                                         |
| Reply button next to the message time            | mouse and keyboard | Shows on hover or focus; the screen-reader and keyboard way to reply                                                              |

Also: reaction picks buzz lightly, the "Replying to ..." bar has a bigger close button, and in a group
each member's name has its own stable colour (a hash of the member id, mixed with the text colour so it
reads on light and dark themes).

Already there and kept: tapping a quoted reply scrolls to the original and flashes it, "Today / Yesterday"
chips, and Copy on a table message copies its markdown (the message text is the markdown).

Not built: delivered/read times in message info (the API does not provide them), and a "scroll to
latest" safe-area change (the button sits above the composer, which already handles the safe area).

## How the swipe decides

All numbers are in `gestures/gestureMath.ts` and are unit tested.

1. The finger goes down. Nothing is decided until it has moved 8 px.
2. Mostly sideways and to the right: a swipe. Anything else (up, down, left): a scroll, and we stay out
   of the way. The bubble has `touch-action: pan-y`, so the browser keeps vertical scrolling and gives
   us the sideways movement.
3. A swipe cancels the long-press timer, so it never also opens the menu.
4. The bubble follows the finger up to 48 px, then gets harder to pull, and stops at 64 px. The reply
   arrow fades in as it goes. It uses the CSS `translate` property because the bubble's entry
   animation owns `transform`.
5. Let go at 48 px or more: reply. Less: it springs back. With "reduce motion" on there is no spring,
   but the swipe still works.

Deleted messages, messages still sending and system lines (joins, renames) ignore all of it: the
gestures run only where the message menu would also open.

The mouse does not drag to reply on a laptop: dragging the mouse selects text, and the Reply button
and the menu are there instead.

## Double tap and text selection

A double tap is two quick touches (300 ms, 24 px) that are not on a link, button or media. A double click
selects a word by itself, so a selection with a space in it (dragged on purpose) is left alone;
otherwise the one-word selection is cleared and the heart is added. A touch double tap is followed by a
browser `dblclick`; the second one is ignored so the heart does not toggle twice.

## Choosing several messages

State is `selection/useSelectionStore.ts` (the open chat's id plus the ticked message ids). Unticking
the last one ends the selection; leaving the chat clears it. While choosing:

- The chat header is replaced by `SelectionBar`: a close button, "N selected", Copy, Forward, Star and Delete.
  There is no Reply (it needs exactly one message).
- A tap anywhere on a message ticks or unticks it, and nothing inside it fires (links, photos). Each row
  has a checkbox (a real `role="checkbox"`, reachable with Tab, toggled with Space or Enter).
- Swipe, double tap, hold and the actions button are off.
- Escape ends it (unless a dialog from the bar is open; Escape closes that first).

The rules for the buttons are in `selection/selectionRules.ts`:

- **Copy**: the text messages, in chat order, one per line. Hidden if none has text.
- **Forward**: `ForwardModal` takes the list; messages that cannot be forwarded (polls, system lines) are
  skipped. Disabled if none can.
- **Star**: stars the ones that are not starred; if all are starred, unstars all.
- **Delete**: "for me" always; "for everyone" only when every chosen message is mine.

Only messages that have actions can be chosen (not deleted ones, not ones still sending). The list stays
virtualized: the ticked ids live in the store, so rows that scroll away and back keep their tick.

## Tests

- `gestures/gestureMath.test.ts`: threshold, intent, rubber band, spring back, reduced motion, double tap, selection, sheet drag.
- `gestures/messageGestures.test.tsx`: swipe sets the reply target, vertical and left drags and short swipes do not, deleted / sending / system messages ignore it, the swipe cancels the hold, double tap and double click toggle the heart, link hold, sheet drag, axe.
- `selection/selection.test.tsx`: store, rules, bar actions (copy, forward, star, delete rules, close, Escape), a message while choosing, axe.
- No Playwright spec yet (skipped for time); the touch swipe and double tap were not run in a real browser.

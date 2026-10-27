# Rich messages

Besides text and files, a Flick chat can carry cards: polls, events with RSVP, checklists, expense splits, quick games, locations (one-off and live), contact cards, GIFs, stickers, view-once media, and the system and call lines the server writes. This page explains each one: what it is, how to make it, its limits, and what is not built. Every card is an ordinary message with a `type` in the shared contract (`packages/contracts/src/content*.ts`); older clients that do not know a type show a plain fallback. Code: `apps/web/src/features/{content,grouptools,productivity,chat/content}` and `apps/api/src/modules/{messages,grouptools}`.

Related: [messaging.md](messaging.md) | [media-and-files.md](media-and-files.md) | [groups.md](groups.md) | [calls.md](calls.md) | [calendar-and-productivity.md](calendar-and-productivity.md) | [reminders.md](reminders.md) | [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md) | [../ai/writing-assistant.md](../ai/writing-assistant.md) | [../ai/README.md](../ai/README.md)

## Message types at a glance

| Type                           | Made from                                            | Can be edited                              | Can be forwarded    |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------ | ------------------- |
| `text`                         | message box                                          | yes                                        | yes                 |
| `image`, `video`, `file`       | attach, camera, paste, drop                          | caption only (video not offered in the UI) | yes                 |
| `voice`                        | microphone                                           | no                                         | yes                 |
| `gif`, `sticker`               | GIFs and stickers button (GIPHY)                     | no (gif caption: server only)              | yes                 |
| `poll`                         | Poll button, `/poll`, "Find a time"                  | no                                         | no                  |
| `event`                        | Chat options, "Create event..."                      | no                                         | no                  |
| `checklist`, `expense`, `game` | Chat tools button                                    | no (state changes through card actions)    | no                  |
| Location, contact card         | tools button                                         | no (live location edits itself)            | yes (they are text) |
| `system`, `call_event`         | written by the server only; clients cannot send them | no                                         | no                  |

## Polls

**What it does.** A question with 2 to 12 options. People vote; results show as bars with counts.

**How to use it.** Poll button in the message box (bar chart icon), the "Poll" item in the plus menu, or type `/poll`. Enter the question (up to 300 characters) and options (each up to 100 characters, no duplicates). Choose "allow multiple answers" if wanted, and a closing time: Never, In 1 hour, In 1 day or In 1 week. Tap an option to vote; tap again to change or remove your vote. The card says "Select one" or "Select one or more", shows "closes <time>", and switches to "Closed" at the closing time. Voting on a closed poll is refused by the server ("This poll is closed."). The poll creator sees "Export results", which downloads a CSV with one row per option: votes and voter names (a leading `=`, `+`, `-` or `@` is neutralised so spreadsheets do not run it as a formula).

**Data.** Votes go to `POST /conversations/:id/polls/:message_id/vote` (a vote replaces your previous choice; an empty list removes it) and the tally is read from `GET /conversations/:id/polls/:message_id`. The poll message itself never changes.

**Status: Built.**
Gap: there is no live vote event yet; an open poll re-reads its tally every 15 seconds, so other people's votes show up with a short delay. A poll cannot be edited after sending, and polls cannot be forwarded.

AI: in groups, the "Describe your message" bar offers "Poll from question" which drafts a poll for you to send. See [../ai/writing-assistant.md](../ai/writing-assistant.md).

## "Find a time" poll

Chat tools button in the chat header, "Find a time (5 suggested slots)" in a group. It sends a multi-answer poll with five suggested times over the next two weeks (weekday lunch and evenings, weekend mornings, in the sender's local time).

**Status: Built.**
Gap: it does not read anyone's calendar; the five slots are fixed rules. The labels are written in the sender's language and time zone.

## Events with RSVP

**What it does.** An event card with a title (up to 100 characters), a date and time, and an optional place (up to 200 characters). Everyone in the chat can answer Going, Maybe or No and sees the counts.

**How to use it.** Chat options menu, "Create event...". Fill in title, when and place. The card is created through the productivity API (`createEvent`) and records answers in `event_rsvps` (`GET` and `POST` RSVP for the message).

**Status: Built.**
Gap: the card does not add itself to your calendar; the Calendar page lists events separately (see [calendar-and-productivity.md](calendar-and-productivity.md)). Events cannot be edited or cancelled after posting.

## Checklists

**What it does.** A shared to-do list. Anyone in the chat can tick or untick an item; the change is stored in the message and shown to everyone.

**How to use it.** Chat tools button, "Make a checklist": a title (default "Checklist", up to 100 characters) and one item per line (1 to 50 items, each up to 200 characters). The multi-select bar also has a checklist button that pre-fills the items with the first line of each chosen text message.

**Data.** Card changes go through `POST /conversations/:id/messages/:id/card/act` with `{op: "toggle", index}`, under a row lock so two people ticking at once both win. They never use the message edit path.

**Status: Built.**
Gap: you cannot add or remove items after sending, and there is no "who ticked it".

## Expense split

**What it does.** Records who paid and who shares the cost, then shows running balances for the group.

**How to use it.** In a group, Chat tools button, "Split an expense": what for (up to 100 characters), amount (for example `42.50`, stored as whole cents so sums are exact, up to 10,000,000.00), who paid (a drop-down of members), and who shares it (tick the members). The card appears in the chat. The group info panel then shows "Expense balances" ("owes" / "is owed"), added up from the expense cards in the messages loaded in that chat. Shares are rounded so the cents always add up.

**Status: Partial.**
Gap: it only tracks balances; there is no "settle up" or payment. The currency is a free text label (default USD) and amounts are not converted. Balances only count expenses in the loaded part of the chat, not necessarily the whole history.

## Quick games

Two games, sent from the Chat tools button.

| Game             | How it works                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tic-tac-toe      | The first two different people to tap a cell become X and O, and turns alternate. The server applies each move (`op: "move"`) and refuses out-of-turn or occupied cells. In a chat with only yourself (Saved messages) you play both sides. |
| Would you rather | A random pair of options from a built-in list. Each person has one vote (`op: "vote"`; voting again replaces it); the card shows the tally.                                                                                                 |

**Status: Built.**
Gap: only these two games; no rematch button (send a new game), and no scores.

## Location and live location

**What it does.** Shares where you are as a text message with an OpenStreetMap link. The card shows a pin, "Location" or "Live location, until HH:MM", and an "Open in OpenStreetMap" link.

**How to use it.** Tools button (map pin icon):

- "Send my location": sends once.
- "Share live location, 15 min", "1 hour" or "8 hours": sends a first position and then updates it.
- On your own live card, "Stop sharing" ends it early, and the card then reads "Live location ended".

The browser asks for location permission. Your position is read with high accuracy (15 second timeout).

**How live sharing works.** It is one text message, edited with the new position every 30 seconds until the time is up or you stop (`📍 Live location until 14:30` plus the link). The message text is a fixed shape (`📍 ...` then `https://www.openstreetmap.org/?mlat=..&mlon=..`), so older clients just show a readable text with a link. If an edit is ever refused, the client posts the next position as a new message and carries on from there. The API has no edit time limit (see [messaging.md](messaging.md)), so in practice the same message keeps updating for the whole share; the fallback is only there in case that changes.

**Status: Partial.**
Gap: live sharing runs in the open Flick tab only. If you close the tab or the phone sleeps the page, updates stop and the last position stays; there is no background location. Two chats can each share live at the same time; one chat shows one share at a time. The map is a link to openstreetmap.org, not an embedded map.

## Contact cards

**What it does.** Shares a person from the people directory as a card with their name and `@username`, plus a "Message" button that opens their profile page.

**How to use it.** Tools button, "Share a contact", pick someone. It is sent as text: `👤 Name (@username)` and a link to `/u/username`, so older clients show readable text.

**Status: Built.**
Gap: it shares the name and username only, not phone numbers or email.

## GIFs and stickers (GIPHY)

The "GIFs and stickers" button opens a picker with search and trending. A GIF or sticker is a message pointing at a GIPHY address (width, height and optional caption for GIFs). The picker talks to the API's GIPHY proxy, not to GIPHY directly, so the key stays on the server. Stickers you make yourself are covered in [media-and-files.md](media-and-files.md).

**Status: Built.**
Gap: needs a `GIPHY_API_KEY` on the server; without it the API answers 503.

## View-once photos, videos and voice notes

Tick "view once" when attaching a photo or video, or in the voice recorder. The receiver opens it once; afterwards the message reads "Opened" and the server stops sending the content to them. The content is blurred whenever the tab loses focus while open. Only photos, videos and voice notes can be view-once (the API rejects the flag on other types), and view-once messages cannot be forwarded. Details and limits are in [messaging.md](messaging.md).

**Status: Built.**
Gap: a deterrent only; the app cannot stop screenshots.

## Round video notes, voice notes, voicemail

Covered in [media-and-files.md](media-and-files.md). A voicemail is a voice note flagged `voicemail`, left after a missed call; it shows a "Voicemail" label above the player.

## System lines and call lines

The server writes these into the chat; people cannot send them.

- System lines: group created, member added, removed or left, role changed, renamed, disappearing timer changed.
- Call lines (`call_event`): a 1:1 call that ended, was missed or declined ("Missed video call", "Voice call, 2:03"), or "started a group call". See [calls.md](calls.md).

## Chat tools menu: other entries

- "Make itinerary from this chat" (needs AI): Flick reads the recent messages (up to 300 lines, 12,000 characters), collects dates, places and bookings into a markdown itinerary, and offers "Save to Saved messages". Result is shown to you only, it is not posted to the chat unless you copy it.
- Chat options, "Make meeting notes" (needs AI): saves meeting notes to your Saved messages.

AI: both are AI features. See [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md).

## Where the AI is used in this page

| Place                                                                 | AI?              | Doc                                                                  |
| --------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| Poll drafted from a question                                          | yes              | [../ai/writing-assistant.md](../ai/writing-assistant.md)             |
| Itinerary, meeting notes                                              | yes              | [../ai/productivity-and-safety.md](../ai/productivity-and-safety.md) |
| Polls, events, checklists, expenses, games, locations, contacts, GIFs | no (plain logic) | n/a                                                                  |

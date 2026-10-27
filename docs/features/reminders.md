# Reminders

A reminder is a note to yourself that comes back at a time you choose, about one message or a whole
chat. When the time comes, Flick posts it in your Flick chat and sends a push notification. You can
pick the time yourself, or (optionally) let Flick read it from the message. Flick can also notice when
you promised something in a sent message and offer to remind you. Status: Built.

## Related

- [Calendar and productivity](calendar-and-productivity.md): reminders on the calendar
- [Notifications](notifications.md): the push, the centre and the briefing
- [Chat list](chat-list.md): the briefing card lists reminders due in 24 hours
- [AI: productivity and safety](../ai/productivity-and-safety.md)
- Code: `features/reminders/`, `features/productivity/`, `apps/api/src/modules/reminders/`,
  `apps/worker/src/jobs/send-reminders.ts`

## How to set one

| Way                                          | What happens                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message menu > **Remind me** (quick remind)  | A small dialog with quick picks: In 1 hour, This evening (6 pm, hidden once 6 pm is too close), Tomorrow 9 am, Next week (same weekday, 9 am). A toast confirms: "We'll remind you tomorrow at 9:00 AM" |
| Same dialog > **Custom...**                  | The full dialog: a date-time field and an optional note (up to 200 characters)                                                                                                                          |
| Same dialog > **Let Flick pick the time**    | AI, optional. Flick reads the message and suggests a short title and a time, then opens the full dialog filled in so you can change it. If the message names no date or time you get a title only       |
| Chat options > **Remind me about this chat** | The same dialog, for the whole chat                                                                                                                                                                     |
| Type `/remind` in the composer               | Same as "Remind me about this chat" (a slash command; optional text becomes the note)                                                                                                                   |
| A nudge in the notifications centre          | See below                                                                                                                                                                                               |

"Let Flick pick the time" is shown only when AI is set up. It sends that one message to the AI, only
when you tap it (`POST /productivity/extract-reminder`). The time must be in the future.

## What you see afterwards

- **Reminders** list (alarm-clock icon in the chat list header, or the "⋮" menu on phones): waiting
  reminders with the quote, chat and time and a Cancel button, then the ones sent in the last 3 days.
  It has loading, empty and error states.
- A small alarm clock sits next to the time on a message that has a waiting reminder.
- The [calendar](calendar-and-productivity.md) shows waiting reminders and lets you edit (it replaces
  the old reminder with a new one) or delete.
- When the time comes, Flick posts in your Flick chat: the quote, who wrote it, which chat, your note
  and an **Open chat** button. It is an ordinary message, so it is unread and reaches every device. A
  Web Push titled **Reminder** is sent as well (a logged no-op when push keys are not set).

## Follow-up nudges

Status: Built. No AI.

In the [notifications centre](notifications.md) a **Did you follow up?** section lists promises you made
in your own recent messages, for example "I will send the report by Tuesday". Each item offers
**Remind me** (opens the reminder dialog; a time word such as tomorrow, Tuesday or next week fills in
9 am on that day, "today" means 6 pm) or dismiss.

How it finds them: a simple pattern match, not AI (`apps/api/src/modules/productivity/promises.ts`).
It looks at your sent text messages from the last 3 days (up to 200 messages), keeps those that are at
least 15 characters, do not end in a question mark and contain a phrase like "I will", "I'll",
"let me", "I promise to" or "will do", and skips messages that already have a reminder. Dismissals are
remembered on this device (up to 100). Endpoint `GET /productivity/nudges`.

## Rules

- At least 1 minute and at most 1 year ahead. At most 50 waiting reminders per person.
- Only members of the chat can set one. A non-member, a message from another chat, a deleted message or
  one hidden "for me" all get the same 404. Reminders are private.
- **No message text is stored.** The `reminders` table (migration `0016_reminders`) holds ids, note,
  time and status. The quote is read when the list is built and when the reminder is sent. If the
  message was deleted or expired, the text says "A message you wanted to be reminded about was deleted."
  Markdown in a quote is escaped.

## API

| Call                                  | Notes                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /reminders`                     | `{ message_id?, conversation_id?, remind_at, note? }`; give at least one target. 201 with the reminder. 409 at the limit |
| `GET /reminders`                      | Waiting plus sent in the last 3 days, soonest first, paged with a cursor                                                 |
| `DELETE /reminders/:id`               | Cancels your own waiting reminder (204). A sent one is history (404)                                                     |
| `POST /productivity/extract-reminder` | AI: `{ message_id }` gives `{ title, remind_at \| null }`                                                                |
| `GET /productivity/nudges`            | Promises found in your recent sent messages                                                                              |

## Delivery

A pg-boss job runs every minute in the worker. For each due row, one transaction locks it
(`FOR UPDATE SKIP LOCKED`, so two workers never take the same one), posts the Flick chat message and
marks it sent. A crash cannot lose or repeat it. If posting fails, the reminder is still marked sent
and the push still goes out. After the commit a `reminder-push` job re-reads the reminder and sends the
push, using the Flick message id as its tag so a phone shows one notification. If you have no Flick chat
only the push is sent.

On the free Render tier the worker only runs while the service is awake, so a reminder can be late;
see [operations](../operations/runbook.md).

## Gaps

| Item                                                | Status                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| Quick remind, full dialog, chat reminder, `/remind` | Built                                           |
| Let Flick pick the time                             | Built; needs AI                                 |
| Nudges                                              | Built; English phrases only, last 3 days        |
| Editing a reminder                                  | Partial: no edit call; the calendar replaces it |
| Repeating reminders                                 | Not built                                       |

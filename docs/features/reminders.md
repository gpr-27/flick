# Reminders ("Remind me")

A reminder is a note to yourself that comes back at a time you choose, about one message or a whole chat.

## What the person sees

- **Message menu > Remind me**: quick picks (In 1 hour, This evening (6 pm), Tomorrow 9 am, Next week), a date-time field and an optional note (up to 200 characters). A toast confirms: "We'll remind you tomorrow at 9:00 AM".
- **Chat options > Remind me about this chat**: the same dialog for the whole chat.
- **Reminders** (alarm clock in the chat list header): waiting reminders with the quote, chat and time, each with a Cancel button, then the ones sent in the last 3 days. It has loading, empty and error states.
- A small alarm clock sits next to the time on a message that has a waiting reminder. It reads one cached list (`reminderStore`), so a long chat makes no extra requests.
- When the time comes, Flick posts in your Flick chat: the quote, who wrote it, which chat, your note and an **Open chat** link (`/?c=<chat id>`, drawn as a button that opens the chat). It is an ordinary message, so it is unread and delivered to every device. A Web Push titled **Reminder** is sent as well (a logged no-op when VAPID keys are not set).

## Rules

- At least 1 minute and at most 1 year ahead. At most 50 waiting reminders per person (checked under a per-user lock, so parallel requests cannot pass it).
- Only members can set one: a non-member, a message from another chat, a deleted message or one hidden "for me" all get the same 404 as something that does not exist. Reminders are private: other people cannot list or cancel yours (404).
- **No message text is stored.** The `reminders` table (migration `0016_reminders`) holds ids, note, time and status. The quote is read when the list is built and when the reminder is sent. If the message was deleted, expired or hidden, the text says "A message you wanted to be reminded about was deleted." Markdown in a quote is escaped, so it cannot format Flick's message.
- Guests: no guest policy exists on this branch yet, so nothing is restricted.

## API

| Call                    | Notes                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /reminders`       | `{ message_id? , conversation_id?, remind_at, note? }`; give at least one target. 201 with the reminder. 409 at the limit. |
| `GET /reminders`        | Waiting plus sent in the last 3 days, soonest first, keyset page (`cursor`, `limit`, `next_cursor`).                       |
| `DELETE /reminders/:id` | Cancels your own waiting reminder (204). A sent one is history (404).                                                      |

## Delivery (apps/worker, `jobs/send-reminders.ts`)

A pg-boss job scheduled every minute (like scheduled messages). For each due row, ONE transaction: lock it (`FOR UPDATE SKIP LOCKED`, so two workers never take the same one), post the Flick chat message, mark it `sent`. A crash cannot lose or repeat it. The chat message runs inside a savepoint: if it fails, the reminder is still marked sent and the push still goes out. After the commit, a `reminder-push` job is queued (singleton per reminder, retried with back-off); it re-reads the reminder and sends the Web Push. The push uses the Flick chat message id as its tag, so a phone that also gets the normal message push shows one notification.

If someone has no Flick chat, only the push is sent.

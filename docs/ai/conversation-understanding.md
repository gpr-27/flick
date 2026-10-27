# Conversation understanding

Flick can read a chat for you and tell you what matters: a summary of what you have not read, answers to questions about a chat, a catch-up card (decisions, questions for you, deadlines), topics, a recap over a date range, a check of one message, and answers inside the chat-list search. A second group of features works without any AI: the "Looks urgent" badge, the Needs reply filter, folder suggestions, the notification digest and chat snooze. This page says which is which, where to find each one, and what happens when AI is off.

Related

- [AI overview](README.md) and [architecture](architecture.md) (provider chain, quotas)
- [Privacy and limits](privacy-and-limits.md)
- [Feature map](feature-map.md)
- [Chat list](../features/chat-list.md), [search and organise](../features/search-and-organise.md), [notifications](../features/notifications.md)
- [Flick assistant](flick-assistant.md) (the `@flick` bot and the Flick chat)

## How all of these read a chat

- The server reads the chat text from Postgres. The browser never sends chat text for these features (`apps/api/src/modules/ai/context.ts`, `loadLines`).
- You must be an active member. You only get messages you could read in the app: nothing from before you joined, nothing deleted or expired, nothing "deleted for me".
- Only messages with text (`body_text`) are read. System and call-event messages are skipped. Voice notes, images and files are not read here (see [files, images and voice](files-images-voice.md)).
- If you turned on "No-AI mode" for a chat (chat menu, `PUT /ai/privacy/:conversation_id`), every feature below refuses with "AI is turned off for this chat".
- Message text goes to the model inside `<messages>` tags with a rule that it is untrusted data. Tags typed by a sender are stripped so they cannot close the block.
- Model path: the shared provider chain. It tries Anthropic `claude-sonnet-5-5` first, then Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`), then Gemini (`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`). A provider with no key is skipped. See [architecture](architecture.md).
- Every request to `/ai/*` counts against a per-user daily limit (`AI_DAILY_LIMIT`, default 200 per UTC day) and 20 requests per minute.
- If no provider key is set, `GET /ai/status` says `enabled: false`, the AI buttons below are hidden or disabled, and the routes answer 503 `AI_UNAVAILABLE`.

## Summary table

| Feature                      | Where                                                                    | AI?                           | Endpoint                                           | Status                                |
| ---------------------------- | ------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------- | ------------------------------------- |
| Summarise chat / unread      | Chat menu "Summarise chat"; "Summarise N unread" chip above the composer | Yes                           | `POST /ai/summarize`                               | Built                                 |
| Ask Flick about this chat    | Chat menu "Ask Flick about this chat"                                    | Yes                           | `POST /ai/chat` with `conversation_id`             | Built                                 |
| Catch-up card                | Card above the composer in a busy chat                                   | Yes                           | `POST /ai/understand` mode `catchup`               | Built                                 |
| Topics in this chat          | Chat menu "Topics in this chat"                                          | Yes                           | `POST /ai/understand` mode `topics`                | Built                                 |
| Recap with Flick             | Chat menu "Recap with Flick..."                                          | Yes                           | `POST /ai/understand` mode `recap`                 | Built (no person picker)              |
| Check this (facts and links) | Chip under an incoming message with a link or number                     | Yes                           | `POST /ai/understand` mode `check`, aspect `facts` | Built                                 |
| Mood and urgency hint        | Badge under an incoming message                                          | Local rule, optional AI check | mode `check`, aspect `mood`                        | Partial: badge is a keyword heuristic |
| Search answers               | Chat-list search, "Ask Flick: ..." row                                   | Yes                           | `POST /ai/understand` mode `search`                | Built                                 |
| Needs reply filter           | Chip above the chat list                                                 | No                            | none                                               | Built                                 |
| Folder suggestion            | Line above the composer "Add this chat to X?"                            | No                            | none                                               | Partial: local guess                  |
| Notification digest          | Settings > Notifications                                                 | No                            | none                                               | Partial: in memory only               |
| Snooze chat                  | Chat menu "Snooze chat..."                                               | No                            | none                                               | Partial: chat only, this device only  |

## Summarise chat

- What it does: bullet points (at most 5, most important first) of the messages you have not read. If nothing is unread, it summarises the newest 30 messages.
- How to use: open the chat menu and pick "Summarise chat". When 5 or more messages are unread a "Summarise N unread" chip also shows next to "Suggest replies".
- Endpoint: `POST /ai/summarize` with `{ conversation_id }`. The answer streams (server-sent events) with the provider and model name.
- Reads: up to 200 unread messages, 1,500 characters each, 40,000 in total. Your own messages are left out.
- Model path: provider chain, system prompt `SUMMARIZE_SYSTEM` in `packages/ai/src/tasks.ts`. Reply is in the language most messages use.
- If AI is off or fails: the menu item shows "AI is not set up on this server" or the error text. No fallback summary is made.
- Status: Built.

## Ask Flick about this chat

- What it does: you type a question ("What time did we decide?") and Flick answers from the latest messages of that chat.
- How to use: chat menu, "Ask Flick about this chat".
- Endpoint: `POST /ai/chat` with `conversation_id` and your question. The server adds the latest 200 messages (300 characters each, 7,000 in total) as a first turn, plus your chosen reply language, your Flick persona and short app knowledge.
- Model path: provider chain, plain chat prompt (`CHAT_SYSTEM`).
- If AI is off or fails: error shown in the dialog. Nothing is stored.
- Status: Built. Only the newest 200 messages (7,000 characters) are visible to it, so it cannot answer about old history. Use Recap for that.

## Catch-up card

- What it does: one short sentence plus up to 12 points, each tagged decision, question (for you) or deadline. The card line reads like "2 decisions, 1 question for you, 1 deadline". Tapping a point jumps to the message it came from.
- How to use: shows above the composer when AI is enabled and the chat has 8 or more unread messages. Tap "Catch me up on N unread". "Hide" removes it for this view.
- Endpoint: `POST /ai/understand` `{ mode: "catchup", conversation_id }`.
- Reads: up to 120 unread messages from others, 400 characters each, 24,000 in total. The model answers in JSON; points that cannot be tied to a real message simply have no jump link.
- If AI is off: the card is not shown.
- Status: Built.

## Topics in this chat

- What it does: groups the chat into up to 10 topics in time order, each with a title and one line. Tap one to jump to where it starts.
- How to use: chat menu, "Topics in this chat" (not shown in the Flick chat itself; the Flick chat has its own topics, see [Flick assistant](flick-assistant.md)).
- Endpoint: `POST /ai/understand` `{ mode: "topics", conversation_id }`. Reads 200 messages, 200 characters each, 24,000 in total.
- Status: Built.

## Recap with Flick

- What it does: answers a question about a time period, for example "What did we agree on?" or "What did Priya promise?". It replies in plain text and says so if the messages do not answer it.
- How to use: chat menu, "Recap with Flick...". Pick a period (7 days, 30 days, 3 months, everything) and type the question.
- Endpoint: `POST /ai/understand` `{ mode: "recap", conversation_id, question, from }`. The server loads the newest 300 messages (400 characters each, 30,000 in total), then keeps those inside the period. Each line carries the sender name and date.
- Gap: there is no person picker. "Recap by person" works only by naming the person in the question. If the period has no messages the answer is "There are no messages in that period." without calling the model.
- Because only the newest 300 messages are loaded, "Everything" means the newest 300, not the whole history.
- Status: Built, with the gaps above.

## Check this (facts and links)

- What it does: judges one message from the message itself and, if it has a link, from the page text. The answer starts with "Verdict:" (supported, partly supported, not supported or cannot verify) and 2 to 4 reasons. It says what it cannot verify.
- How to use: a "Check this" chip appears under incoming text messages that contain a link, or are longer than 40 characters and contain a digit.
- Endpoint: `POST /ai/understand` `{ mode: "check", aspect: "facts", conversation_id, message_id }`.
- The server fetches the first link itself with `fetchPageText`: public http or https only, ports 80 and 443 only, private and local addresses refused, no redirects, 5 second limit, at most 300 KB read and 8,000 characters kept. If the page cannot be fetched, the model is told so and answers from the message alone.
- Limits: the message is cut to 2,000 characters. The model has no other knowledge source and no web search.
- Status: Built.

## Mood and urgency badges

- What it does: a small badge under an incoming text message: "Looks urgent" or "Sounds upset".
- How it works: this is a local keyword rule in the browser (`apps/web/src/features/understand/heuristics.ts`). Words such as urgent, asap, emergency or three exclamation marks give "urgent". Words such as angry, unacceptable, wtf or mostly capital letters give "upset". Nothing is sent anywhere.
- Optional AI: when AI is on, the badge reads "... · Check with AI". Tapping it calls `POST /ai/understand` with `aspect: "mood"`. The answer has two lines, "Mood:" and "Why:", quoting what in the text shows it. Message is cut to 2,000 characters.
- If AI is off: the badge still shows (it is local) but is not tappable.
- Status: Partial. The badge is a heuristic and misses sarcasm, other languages and anything not in the word lists. The AI check is on demand only.

## Search answers in the chat-list search

- What it does: type a question in the chat-list search, for example "when is the meeting tomorrow", and an "Ask Flick: ..." row appears. Tapping it answers briefly with sources like [2]; each source jumps to the message.
- When the row appears: AI enabled and the query looks like a question (3 or more words, ends with "?" or starts with what, when, where, who, why, how, which, did, do, does, is, are, was, were, can, could, will). Code: `looksLikeQuestion.ts`.
- Endpoint: `POST /ai/understand` `{ mode: "search", query }`. The server takes up to 6 words (3 letters or more) from the question, finds up to 40 recent messages containing any of them in chats you are in (since you joined, visible to you), drops chats where you turned AI off, keeps 8, and asks the model to answer using only those.
- Limits: this is word matching, not meaning-based search, so a question phrased with different words than the messages may find nothing ("I found no messages about that."). Each message is cut to 400 characters.
- Status: Built.

## Needs reply filter

- What it does: a "Needs reply - N" chip above the chat list. When pressed, the list shows only chats where the last message is from the other person and is older than 2 hours.
- Rules (`needsReply` in `heuristics.ts`): not the Saved chat, not archived, last message not from you, snoozed chats excluded from the count. It uses the last message of the chat summary, so it works for any message type.
- AI: none. Works with AI off.
- Status: Built.

## Auto-sort suggestion

- What it does: in a chat that is in no folder, a line above the composer says "Add this chat to Work?" with Add and "No thanks". Dismissal is remembered on this device.
- How it decides (`features/lists/sortRules.ts`): a folder or tag whose name (3 letters or more) appears in the chat title or last message; otherwise, for groups, a folder named like group, team, work or family; for direct chats, one named like friend, personal or people.
- AI: none. It is a local guess from names, not a model.
- Status: Partial. No learning, no AI.

## Notification digest

- What it does: Settings > Notifications > "Notification digest" can be Off, every 1, 3 or 6 hours. Non-urgent desktop notifications are held and shown as one "Flick digest" notification with a line per chat ("Maya: 3 new messages"). Mentions, keyword alerts and messages with an urgent or upset hint still come straight through.
- AI: none.
- Gap: the held counts live in browser memory (`features/notifications/digest.ts`). If the tab closes before the digest is shown, the held notifications are lost. The choice itself is saved in local storage on that device. It applies to notifications shown by the open app, not to push.
- Related and different: the server-side morning briefing (Flick chat, daily or weekly) is a plain count with no AI. See [productivity and safety](productivity-and-safety.md).
- Status: Partial.

## Snooze chat

- What it does: hides a chat from the chat list and takes its unread count out of the unread total until a chosen time. Choices: 1 hour, 3 hours, tomorrow morning (9:00), next week (Monday 9:00).
- How to use: chat menu, "Snooze chat...". A snoozed chat is still shown if it is the one open.
- Where it is stored: browser local storage on this device (`flick.snoozes`). It does not sync across devices and the server does not know about it. It does not mute push notifications by itself.
- AI: none.
- Gap: snoozing a single message is not built.
- Status: Partial.

## When AI is off or fails

| Situation                         | Result                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No provider key on the server     | AI buttons hidden or disabled; local features (badges, Needs reply, folder suggestion, digest, snooze) keep working                                        |
| All providers busy or in cooldown | 503 "All AI providers are unavailable"; the dialog shows the message                                                                                       |
| Timeout                           | 503 "Flick took too long" (`/ai/understand` allows 30 seconds per attempt and 45 in total; summarize and chat use the chain defaults of 25 and 90 seconds) |
| Daily limit reached               | 429, "Daily AI limit reached (200). Resets at midnight UTC"                                                                                                |
| Chat has No-AI mode on            | 403 "AI is turned off for this chat"                                                                                                                       |

## Privacy notes

- Chat text for these features is sent to the provider chain (Anthropic, Groq or Gemini, whichever answers). See [privacy and limits](privacy-and-limits.md).
- Messages are plain text on the server (see ADR-0011 in `docs/decisions/`), so there is no end-to-end encryption to break; the per-chat No-AI switch is the control.
- The answer and your question are not stored by these endpoints. The daily counter per feature is kept in Redis.

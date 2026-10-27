# Productivity and safety

This page covers two groups. Productivity: the Saved-messages "second brain" (ask your notes, auto-tag), reminders made from a message, the morning briefing, meeting notes, follow-up nudges, the trip planner, checklists, expense split and events with RSVP. Safety: link warnings, the scam banner, look-alike names, group moderation, icebreakers, the weekly mood summary, group analytics and welcome text. For each item it says whether a model is used. In short: only ask-notes, tag-with-Flick, make-a-reminder, meeting notes, itinerary, mood summary, icebreaker and the optional link check call a model. Everything else is plain code.

Related

- [AI overview](README.md), [architecture](architecture.md), [privacy and limits](privacy-and-limits.md)
- [Conversation understanding](conversation-understanding.md) (summaries, needs-reply, snooze, digest of notifications)
- [Writing assistant](writing-assistant.md) ("Do it for me", plan assistant, poll from a question)
- [Feature map](feature-map.md)
- [Calendar and productivity](../features/calendar-and-productivity.md), [reminders](../features/reminders.md), [groups](../features/groups.md), [safety and privacy](../features/safety-and-privacy.md), [integrations](../features/integrations.md)

## Which parts use AI

| Feature                                                    | Model?                                | Fallback without AI                          |
| ---------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| Ask Saved messages                                         | Yes                                   | Tools are hidden when AI is not configured   |
| Tag with Flick                                             | Yes, with a rule fallback             | Keyword rules (`guessTag`) tag the notes     |
| Make a reminder from a message ("let Flick read the time") | Yes                                   | Quick presets and the manual reminder dialog |
| Morning briefing (worker job)                              | No                                    | Not applicable                               |
| Briefing card in the chat list                             | No                                    | Not applicable                               |
| Meeting notes                                              | Yes                                   | Menu item hidden                             |
| Follow-up nudges                                           | No (phrase patterns)                  | Not applicable                               |
| Trip itinerary                                             | Yes                                   | Menu item hidden                             |
| Checklist, expense split, find a time, games               | No                                    | Not applicable                               |
| Events and RSVP                                            | No                                    | Not applicable                               |
| Link safety warning                                        | No (address rules); optional AI check | Warning shows; "Check with AI" hidden        |
| Scam banner                                                | No (word and link rules)              | Not applicable                               |
| Look-alike name banner                                     | No (name rules)                       | Not applicable                               |
| Flagged messages list                                      | No (word rules)                       | Not applicable                               |
| Group moderation "flag" AI task                            | Yes, but API only                     | No UI                                        |
| Icebreaker                                                 | Yes                                   | Button hidden                                |
| Weekly mood summary                                        | Yes                                   | Button hidden                                |
| Group analytics                                            | No (SQL counts)                       | Not applicable                               |
| Group welcome text                                         | No (text set by an admin)             | Not applicable                               |

## Saved-messages second brain

Saved messages is your private chat with yourself. Code: `apps/api/src/modules/productivity/routes.ts`, `apps/web/src/features/productivity/SavedTools.tsx`.

### Ask Saved messages

- What it does: you ask "What did I save about the flight?" and Flick answers from your saved notes, with the notes it used listed under the answer.
- Where: bar at the top of the Saved messages chat, "Ask Saved messages". Hidden when AI is not configured.
- Endpoint: `POST /productivity/ask-saved` `{ question }` (up to 500 characters in the UI). The server reads your newest 300 saved text messages (400 characters each), numbers them, and asks for JSON `{ answer, sources }`. If the model does not return JSON, the raw text is shown as the answer. Up to 8 sources are returned.
- Model path: provider chain, 1,000 token answer, 40 second attempt and 60 second total limit.
- If the Saved chat is empty: "Your Saved messages are empty." without a model call.
- Status: Built.

### Auto-tag ("Tag with Flick")

- What it does: gives each untagged saved message one tag: note, link, task, idea or receipt. You can then filter by tag with the chips.
- Endpoint: `POST /productivity/tag-saved` tags up to 30 untagged messages (300 characters each) per press. `GET /productivity/tags` lists tags.
- Fallback: if AI is off, fails, or leaves a message untagged, `guessTag` decides by rules: a URL gives link; a receipt/invoice/paid/total word or a currency amount gives receipt; to-do words (todo, remember to, need to, buy, call, send) give task; idea words give idea; otherwise note. The rule tagging happens on the server even without a model, but the buttons are in the Saved tools, which are hidden when AI is not configured.
- Tags are stored per user and message in `message_tags` and are never overwritten.
- Status: Built.

### Make a reminder from a message

- What it does: from a message, "Remind me" opens quick choices (later today, tomorrow, next week, custom) and one that lets Flick read the time and title from the message text.
- Endpoint: `POST /productivity/extract-reminder` `{ message_id }` returns `{ title, remind_at }`. The model gets the current UTC time and the message (1,000 characters). `remind_at` is null unless the model returns a valid future time. The result pre-fills the normal reminder dialog; nothing is created until you save.
- If AI is off or fails: an error toast; the preset choices still work. See [reminders](../features/reminders.md).
- Status: Built.

## Briefing and digest

- Worker job `send-digest` (`apps/worker/src/jobs/digest.ts`): runs hourly at minute 5. For each person who set the briefing to daily or weekly, when it is 08:00 in their time zone (the quiet-hours time zone) it posts a message from the Flick bot in their Flick chat: reminders due in the next 24 hours (up to 5), the number of chats with unread messages, and the number of saved items. Weekly goes out on Monday only. A person is skipped if one was sent in the last 20 hours. There is no model call; the text is a template.
- Where to set it: Settings > Notifications > "Briefing and quiet hours" (off, daily, weekly). The setting is `productivity_settings.digest`.
- Briefing card: a collapsible card at the top of the chat list (`GET /productivity/digest`) with reminders due in 24 hours, up to 5 chats with unread counts and the saved count. It hides when there is nothing due and nothing unread. The response has a `summary` field that is always `null`; no AI summary is built.
- Related but separate: the notification digest in the browser, see [conversation understanding](conversation-understanding.md).
- Status: Built, no AI.

## Meeting notes

- What it does: turns the last N messages of a chat into "Minutes" plus "Action items" and saves the text in your Saved messages chat.
- Where: chat menu, "Make meeting notes" (only when AI is configured; not shown in the Flick chat).
- Endpoint: `POST /productivity/meeting-notes` `{ conversation_id, count }` with count 5 to 200 (default 50). Reads at most 20,000 characters, 500 per message. The chat's No-AI switch applies. Returns `{ text, saved }`.
- If the Saved chat cannot be found, the text is returned with `saved: false` and not stored.
- Status: Built.

## Follow-up nudges

- What it does: finds promises you made in the last 3 days, such as "I will send the report tomorrow", and asks "Did you follow up?" with Remind me and Dismiss.
- Where: the Notifications page, top section.
- How: `GET /productivity/nudges` scans your last 200 text messages and matches phrases (I'll, I will, I'm going to, I can, let me, I promise to, will do, I'll get back to you). Questions and texts under 15 characters are ignored. A time word (today, tomorrow, a weekday, next week...) is turned into 9:00 that day for the reminder. Messages that already have a reminder are skipped. Up to 5 are shown. Dismissals are kept on the device.
- AI: none (`promises.ts`).
- Status: Built. It matches English phrases only.

## Trip planner (itinerary)

- What it does: collects the dates, places, bookings and plans in a chat into a markdown itinerary with one section per day and an "Unscheduled" section.
- Where: "Chat tools" button in the chat header, "Make itinerary from this chat" (only when AI is on). "Save to Saved messages" keeps the result.
- Endpoint: `POST /conversations/:conversation_id/group-ai` `{ task: "itinerary" }`. Reads up to 300 messages, 400 characters each, 12,000 in total. Any member can use it. The No-AI switch applies. 900-token answer, 30 second attempt, 45 total.
- Status: Built. The model is told to use only facts in the chat, but it can still be wrong; check before relying on it.

## Shopping list, checklist, expense split, find a time, games

All of these are shared cards or polls in the "Chat tools" dialog. None uses AI.

| Tool                                    | How it works                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Make a checklist (shopping list, to-do) | One item per line; any member ticks items (`POST .../messages/:id/card/act` `toggle`)                                                   |
| Split an expense (groups)               | An expense card with payer, amount and who shares it; balances are computed in whole cents and shown in group info ("owes" / "is owed") |
| Find a time (groups)                    | Posts a poll with 5 time slots generated locally over the next days                                                                     |
| Tic-tac-toe, Would you rather           | Game cards; moves and votes are stored in the message                                                                                   |

The "Plan" assistant that suggests free times from your reminders and scheduled messages, and the "Do it for me" and poll-from-question tools, are AI features documented in [writing assistant](writing-assistant.md).

## Events with RSVP

- Create: chat menu, "Create event..." (title, date and time, place). Sends an Event card (`POST /events`).
- RSVP: Going, Maybe or No on the card; `PUT /events/:message_id/rsvp`; counts via `GET /events/:message_id/rsvp`.
- The Calendar page lists shared events on the selected day (`GET /events`) next to reminders and scheduled messages.
- AI: none.
- Status: Built.

## Safety

### Link safety

- Before a link opens, `assessLink` (`apps/web/src/features/safety/linkSafety.ts`) looks only at the address text; nothing is fetched. It flags: an "@" in the host, a raw IP address, look-alike (punycode or non-ASCII) host names, shortened links, unusual endings (.zip, .tk, .xyz, .top and others), many sub-domains, a famous brand name on a site that is not the brand's `.com`, and http pages asking about login or accounts. "danger" shows a stronger warning than "warn". You can cancel or open anyway.
- Optional AI check: if AI is on, "Check with AI" calls `POST /ai/link-check` `{ url }`. The model sees only the address text (it never visits it) and answers in at most 3 short sentences whether it looks safe, suspicious or dangerous. This route is registered outside the `/ai` guard, so it is not counted in the daily AI quota or per-minute AI limit.
- Status: Partial. Heuristics only unless you tap the AI check; no database of known bad sites.

### Scam detector

- What it does: in a direct chat where the other person is new (you have not sent anything yet), a red banner "This looks like a scam" appears with the reasons and Block and report / dismiss.
- How: `scamScore` in `scam.ts` adds points for rush words, crypto or money talk, prize claims, "verify your account", asking for an OTP/PIN/seed phrase, moving to another app, easy-money offers, generic greetings, and suspicious links. The banner shows at a score of 3 or more.
- AI: none. There is no AI check for this banner.
- "Block and report" calls the report endpoint with reason "scam" and block on.
- Status: Partial (word rules, English only).

### Impersonation warning

- What it does: in the same new-chat situation, warns when the person's display name copies someone you already chat with.
- How: `findImpersonated` normalises names (case, accents, spaces, digit and symbol look-alikes such as 0 for o) and flags an exact match after clean-up, or one typo away for names of 6 letters or more. It compares against the display names of your other direct chats.
- AI: none.
- Status: Built as a heuristic.

### Group moderation

- Flagged messages: group admins see "Flagged messages" in group info (`GET /conversations/:id/flagged`). The server scans the latest 300 text messages and lists up to 30 that match word rules: rude words, spam words, almost all capitals, three or more links, ten repeated characters. Admins can delete from the list. No AI.
- AI "flag" task: `POST /conversations/:id/group-ai` `{ task: "flag" }` (admins only) asks the model for up to 5 rude, harassing or spam messages. It exists in the API only; no screen calls it.
- Slow mode: admins set a wait between messages (group info); members see a countdown. No AI.
- Mute for flagged senders is not built.
- Status: Partial.

### Icebreakers

- What it does: when a group has been quiet for more than 3 days, group info shows "This group is quiet" and "Suggest an icebreaker". The model proposes one friendly message based on what the group talks about; "Send to the group" posts it as you.
- Endpoint: `POST /conversations/:id/group-ai` `{ task: "icebreaker" }`; any member. Reads up to 150 messages (400 characters each, 12,000 in total).
- Status: Built.

### Weekly mood summary

- What it does: admins press "Summarise the mood" in group info to get 4 short bullets on overall tone, main topics and tension.
- Endpoint: `POST /conversations/:id/group-ai` `{ task: "mood" }`, admins only.
- Note: the prompt asks about the past week, but the server does not filter by date; it reads the newest 150 messages (12,000 characters), so in a busy group it may cover less than a week.
- Status: Built, on demand (not scheduled).

### Group analytics

- Group admins see the last 30 days: total messages, top 5 senders, busiest hours (UTC) and the time of the last message. `GET /conversations/:id/analytics`, plain SQL, no AI.

### Welcome text

- Group welcome message and rules: an admin writes text in group info (`PATCH /conversations/:id/group-tools`). New members see it as a dismissible banner; others see it in group info. No AI.
- Do not confuse it with the first message Flick posts in a new user's Flick chat, which is fixed text from the server (`welcome.ts`) and not AI-generated.

## Other platform features (no AI)

Incoming webhooks per group, email-to-chat (needs an inbound email provider and `INBOUND_EMAIL_SECRET`; mail to `username@...` is posted into Saved messages by the Flick bot), storage per chat, "Your week in Flick" statistics (`GET /me/stats`: messages sent, voice minutes, top 3 chats) and the new-device sign-in alert. See [integrations](../features/integrations.md).

## Limits and privacy

- Productivity routes (`/productivity/*`) and group tools do not use the shared AI daily counter. They use their own provider calls with the timeouts above. The `/ai/*` features are counted (200 per day by default).
- Group AI tasks and meeting notes read chat text through the shared reader: members only, nothing before you joined, and the No-AI switch applies. Ask-saved and tag-saved read only your own Saved chat. Extract-reminder reads one message you can see and does not check the No-AI switch.
- Chat text goes to whichever provider answers (Anthropic, Groq or Gemini). See [privacy and limits](privacy-and-limits.md).

# AI privacy, quota and limits

Everything about how much AI a person can use, how they see it, how they switch it off for one chat, how they
download or delete what Flick stored, and what text leaves the server. In short: there is a daily request quota
(200 by default), a usage page in Settings, a per-chat "No-AI mode" switch that the server enforces, a download and
a clear button for AI data, and prompts that treat all chat text as untrusted. Chat text is always read by the
server from the database for the signed-in member; the browser never uploads chat history for AI. There are some
gaps, listed honestly below.

## Related

- [AI overview](README.md)
- [Architecture](architecture.md): guards, rate limits, endpoint table
- [Flick assistant](flick-assistant.md): memory and topics (the data you can delete)
- [Writing assistant](writing-assistant.md): style profile and persona (also deletable)
- [Translation and transcription](translation-and-transcription.md)
- [Safety and privacy features](../features/safety-and-privacy.md)
- [Settings](../features/settings.md)

## Daily quota

| Item             | Value                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Limit            | `AI_DAILY_LIMIT`, default 200 requests per person                                                        |
| Day              | Midnight to midnight UTC. The usage card shows "Resets at midnight UTC"                                  |
| Counted in       | Redis key `ai:quota:<user>:<date>` plus a per-feature hash, kept 3 days                                  |
| Over the limit   | HTTP 429 "Daily AI limit reached (200). Resets at midnight UTC"; the bot posts the same text in the chat |
| Redis down       | Fails open: requests are allowed                                                                         |
| Per-minute limit | 20 AI requests per person per minute on top of the daily quota (429 with `retry-after`)                  |

What uses one request: each call to summarize, suggest-replies, translate, Ask Flick (`/ai/chat`), every
`/ai/compose` call, understand, style profile, chat style and persona routes (reads included), do-it-for-me, plan,
poll draft, study helper, dictation clean-up, each file analysis, and each answer from the Flick bot.
Ghost text ("Suggest as I type") calls compose after every typing pause, so when it is on it can use the quota
quickly; it has its own limit of 12 per minute.

Also counted:

- Voice transcription (`/ai/transcribe`): one request, only when Whisper is really called. If the message already
  has a transcript and you did not ask for another language, the saved text comes back free.
- Auto translate (`/ai/translate-batch`): one request per call that reaches the model. Answers found in the
  translation cache are free.
- Auto transcribe: one request, charged to the member it is for (the first member who turned it on for that chat and
  has not switched Flick off there; a voicemail is wanted by everyone). Out of quota means no transcript, quietly.

What is not counted: reading or editing a transcript (`GET` and `PUT /ai/transcript/:attachment_id`), dictation's
Whisper call (it is inside the counted `dictate` request), follow-up chips, memory extraction, group tools, link check
and the `/productivity/*` routes. Those have only their own per-minute limits.

A request that is refused after the quota step in the `/ai` scope (AI off for the chat, or the minute limit) still uses
one request, because the counter is increased first. The transcription and translate-batch routes check the chat
switch before they count, so a refusal there costs nothing.

## Usage page

Settings, "Flick assistant" card, "AI use today": a bar with "X of 200 requests", the reset time, and a list per
feature (Summaries, Reply suggestions, Translations, Write with Flick, Ask Flick, File analysis, Voice transcripts,
Flick in chats; other route names are shown as they are). Data comes from `GET /ai/usage`. The shown number never
goes above the limit.

## Per-chat switch ("No-AI mode")

| Item                  | Value                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where                 | Chat menu, "No-AI mode: turn on" (the label flips to "No-AI mode is on: turn off")                                                                                                                                                                                                                                                             |
| Stored                | `ai_chat_privacy (user_id, conversation_id, allow)`, default allow. Personal to you: it does not change what other members can do                                                                                                                                                                                                              |
| API                   | `GET /ai/privacy/:conversation_id`, `PUT` with `{ allow }` (404 if you are not a member)                                                                                                                                                                                                                                                       |
| Effect                | Server side. `loadLines`, the single function that reads chat text for AI, refuses with "AI is turned off for this chat". Also the guard refuses any `/ai` body that names that chat (403), and `/ai/analyze` refuses files sent in that chat. The same switch now also covers style samples, voice transcription and translation (list below) |
| In a group, Flick bot | If the person who mentioned `@flick` has AI off for that chat, Flick answers once "AI is turned off for this chat. You can turn it on in the chat menu." and reads nothing                                                                                                                                                                     |
| Clearing AI data      | "Clear my AI data" deletes these rows, so every chat goes back to allowed                                                                                                                                                                                                                                                                      |

Covered by the switch: summarize, suggest-replies, Ask Flick with chat context, understand (catch-up, topics, recap,
check, search), compose reply mode, flashcards from a chat, group tools, the bot. Search mode of understand checks the
switch per chat. Also covered now:

| Path                                                                                                                    | What the switch does                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Style samples (the few of your own recent messages added to reply suggestions and compose "write", "reply", "complete") | Messages from a chat with the switch off are left out                                                 |
| Style profile refresh (your last 50 sent text messages)                                                                 | Same: chats with the switch off are not a source                                                      |
| `POST /ai/transcribe`, transcript lookup (`GET`) and edit (`PUT`)                                                       | 403 "AI is turned off for this chat"; no audio goes to Whisper                                        |
| Auto transcribe                                                                                                         | Skipped for a member who has the switch off; the quota of another member who allows it may pay for it |
| `POST /ai/translate-batch` (auto translate and "Send in <language>")                                                    | Needs `conversation_id`; 403 when the switch is off                                                   |
| `POST /ai/translate`                                                                                                    | Takes `conversation_id` as an optional field; when the app sends it, the guard applies the switch     |

Gaps (found in code):

| Path                                                             | Why                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /ai/translate` called without `conversation_id`            | The field is optional, so a caller that leaves it out is not checked. The app sends it for chat messages |
| Text you type yourself (compose polish, rewrite, tone and so on) | You sent it on purpose, so it reaches the model only when you ask; there is no chat text involved        |

## Turning AI off completely

| How                       | What it does                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No API keys on the server | Whole feature off (see [overview](README.md))                                                                                                                                                                                                                                                                                                      |
| No-AI mode on a chat      | That chat is never read                                                                                                                                                                                                                                                                                                                            |
| Do not use the features   | Nothing runs on its own except: ghost text and tone check (both off by default), follow-up chips (off by default), auto translate and auto transcribe (off by default, per chat; both now count against the quota and respect the chat switch), memory extraction in the Flick chat (on), style-profile refresh when you use Write with Flick (on) |

There is no single account-wide "AI off" switch in the app today. Status: Partial.

## Download and clear AI data

Settings, "Flick assistant" card: "Download my AI data" and "Clear my AI data" (two-step confirm).

|                                                                         | Download (`GET /ai/data`)                             | Clear (`DELETE /ai/data`)                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Chat switches and speed                                                 | yes (`settings`)                                      | deleted                                                                                 |
| Today's usage by feature                                                | yes (`usage_today`)                                   | per-feature counts deleted; the daily total stays, so clearing does not reset the limit |
| Writing style summary, persona, per-chat styles                         | yes (`writing`)                                       | deleted                                                                                 |
| Flick memories, topics and thumbs ratings                               | yes (`flick_assistant`: memories, topics, ratings)    | all deleted                                                                             |
| Transcripts you authored or edited (`translation.transcripts`)          | yes                                                   | deleted. A transcript someone else made for a message stays                             |
| Auto translate per chat, auto transcribe per chat, translation settings | yes (`auto_translate`, `chat_transcribe`, `settings`) | deleted                                                                                 |
| Translation cache (Redis, 7 days)                                       | no                                                    | no; it expires by itself                                                                |
| Your chat with Flick                                                    | no                                                    | no. Use "Clear my chat with Flick" (removes the messages for you only)                  |

"What Flick remembers" (Settings link, route `/memory`) lets you add, edit, delete one fact or forget everything
(`DELETE /flick/memories`).

## What text leaves the server, and where

All AI calls come from the API server, never from the browser. Keys stay on the server.

| Feature          | What is sent                                                                                                             | To whom                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Summarize        | Up to 200 unread messages (sender name, time, text; 1,500 chars each)                                                    | Chain: Anthropic, then Groq, then Gemini         |
| Suggest replies  | Last 15 messages, a short style summary and a few of your own recent lines                                               | Chain                                            |
| Ask Flick        | Your question turns (last 20), optionally 200 recent chat messages (300 chars each), app knowledge, language and persona | Chain                                            |
| Flick bot        | Last 20 messages (500 chars each), app knowledge, memories (Flick chat only), page text of a link, the file you attached | Chain                                            |
| Compose tools    | The text you typed or selected; reply mode adds the last 10 messages                                                     | Chain                                            |
| Understand       | Up to 120 to 300 messages depending on the mode                                                                          | Chain                                            |
| Images, PDFs     | The resized image or the PDF itself                                                                                      | Anthropic or Gemini only (Groq cannot read them) |
| Voice, dictation | The audio file                                                                                                           | Groq Whisper only                                |
| Translate        | The message text                                                                                                         | Chain                                            |
| Link check       | The link text only; Flick does not open it                                                                               | Chain                                            |

Providers are Anthropic, Groq and Google (Gemini). What each provider does with the text after receipt (retention,
training) is set by their terms and plan, which the code cannot show. The old guidance in this repo says: on
Gemini's free tier Google may use requests to improve its products. Treat free tiers as not private. The Ask Flick panel
shows the note "Messages you send here may be processed by an AI provider."

Other people's messages are included when you ask Flick about a chat (they are part of the chat). The bot never puts
other people's emails, about text or tokens in its app knowledge; other people appear there only as names of chats
you are in.

## Retention (what we store)

| Data                                  | Where                                                                                                                                 | Kept                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Prompts and replies sent to providers | Not stored by Flick, never logged                                                                                                     | n/a                                                                    |
| Bot replies                           | Normal messages in the chat (with `ai_provider`, `ai_model`, `ai_sources` in the message content)                                     | Like any message                                                       |
| Memories, topics, ratings             | Postgres `ai_memories` (max 200 facts of 300 chars), `ai_topics`, `ai_feedback`                                                       | Until you delete them                                                  |
| Style summary, persona, chat styles   | Postgres `ai_style_profiles`, `ai_chat_style`                                                                                         | Until you delete them; summary refreshes weekly                        |
| Chat switches                         | Postgres `ai_chat_privacy`                                                                                                            | Until cleared                                                          |
| Speed preference                      | Redis `ai:speed:<user>`                                                                                                               | No expiry                                                              |
| Quota counters                        | Redis                                                                                                                                 | 3 days                                                                 |
| Provider cooldowns                    | Redis                                                                                                                                 | 1 minute to 1 hour                                                     |
| Translations                          | Redis `tr:<user>:<lang>:<message>`                                                                                                    | 7 days                                                                 |
| Voice transcripts                     | Postgres `message_transcripts` (with `author_id`, the person who asked for it or last edited it), shared with the chat and searchable | With the message; your authored ones are removed by "Clear my AI data" |
| Page text Flick fetched               | In memory for one reply                                                                                                               | Not stored                                                             |

## Costs and free-tier caveats

| Topic         | Fact                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic     | Paid. It is first in "Best quality" mode, so with a key set most calls go there. Without that key the app runs on Groq and Gemini                 |
| Groq, Gemini  | Free tiers have rate limits and daily caps. The chain handles that by cooling down the model and moving on; two accounts each double the room     |
| Fast mode     | Tries Groq and Gemini first and Anthropic last, which saves paid calls                                                                            |
| Spend control | Only the per-person request count. There is no money cap and no per-feature cost weighting; a long summary counts as one request like a short one |
| Hidden calls  | Memory extraction (up to 10 per hour), follow-up chips, style-profile refresh and ghost text make extra calls; most are outside the quota         |
| Voice         | Whisper on Groq: file limit 25 MB per recording                                                                                                   |

## Limit reference

| Limit                         | Value                                                                |
| ----------------------------- | -------------------------------------------------------------------- |
| Daily requests                | 200 (`AI_DAILY_LIMIT`)                                               |
| Per minute                    | 20 per person (ghost text 12, bot in group 5, bot in Flick chat 20)  |
| Message text length           | 65,000 characters (`LIMITS.MAX_TEXT_LENGTH`)                         |
| Translate text                | 5,000 characters                                                     |
| Write instruction             | 2,000 characters                                                     |
| Ghost text input              | 8 to 400 characters typed, 600 accepted by the API                   |
| Chat history in Ask Flick     | 30 turns, 8,000 characters each                                      |
| Memory                        | 200 facts, 300 characters each                                       |
| Files in general (upload)     | 1 GB                                                                 |
| Images for Flick              | 25 MB source, resized to 1568 px longest side, 10 MB after           |
| PDF for Flick                 | 20 MB                                                                |
| Word and Excel for Flick      | 20 MB                                                                |
| Text and code files for Flick | 1 MB                                                                 |
| Audio for Whisper             | 25 MB                                                                |
| File text to the model        | 60,000 characters                                                    |
| Page text from a link         | 6,000 characters (fetched with a 5 s timeout, 1 MB cap, 3 redirects) |
| Study helper text             | 12,000 characters                                                    |
| Provider time                 | 25 s per attempt, 90 s total (shorter on some routes)                |

## Status

| Part                       | Status    | Gap                                                                                                                                                                                            |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily quota and usage page | Built     | Transcribe, translate-batch and auto transcribe are counted; follow-up chips, memory extraction, group tools, link check and `/productivity/*` are not; refused `/ai` requests may still count |
| Per-chat switch            | Built     | Covers style samples, transcription and translation; `/ai/translate` without a chat id is unchecked                                                                                            |
| Download and clear AI data | Built     | Does not cover the translation cache or other people's transcripts                                                                                                                             |
| Account-wide AI off        | Not built | Only per chat, or no keys                                                                                                                                                                      |
| Spend cap                  | Not built | Request counts only                                                                                                                                                                            |

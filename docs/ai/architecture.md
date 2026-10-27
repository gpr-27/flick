# AI architecture

All AI text calls go through one class, `AiChain` in `packages/ai/src/chain.ts`. It owns the provider order, the
fallback rules and the cooldowns. The API wraps it in `apps/api/src/modules/ai/` and adds what the package cannot
know: who is calling, the daily quota, the per-chat privacy switch, and reading chat text from Postgres. This page
covers the provider chain, key rotation, capability routing, prompts and fencing, rate limits, the guards, the
data registry, every AI endpoint, and the config variables.

## Related

- [AI overview](README.md)
- [Privacy and limits](privacy-and-limits.md)
- [Writing assistant](writing-assistant.md), [Flick assistant](flick-assistant.md)
- [Conversation understanding](conversation-understanding.md), [Files, images and voice](files-images-voice.md)
- [Translation and transcription](translation-and-transcription.md), [Productivity and safety](productivity-and-safety.md)
- [Decision record 0014](../decisions/0014-ai-provider-fallback-chain.md)
- [Operations runbook](../operations/runbook.md)

## Code map

| Part                                                        | Path                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Chain, walk, streaming                                      | `packages/ai/src/chain.ts`                                                                                                     |
| Provider adapters, model lists, capabilities                | `packages/ai/src/providers.ts`                                                                                                 |
| Error classification and cooldown lengths                   | `packages/ai/src/errors.ts`                                                                                                    |
| Cooldown store (Redis, in-memory)                           | `packages/ai/src/cooldown.ts`                                                                                                  |
| Fixed-window rate limiter (Redis)                           | `packages/ai/src/rate-limit.ts`                                                                                                |
| Built-in tasks: summarize, suggest replies, translate, chat | `packages/ai/src/tasks.ts`, `packages/ai/src/routes.ts`                                                                        |
| API wiring, guard, compose                                  | `apps/api/src/modules/ai/routes.ts`                                                                                            |
| Quota                                                       | `apps/api/src/modules/ai/quota.ts`                                                                                             |
| Per-chat privacy, speed preference                          | `apps/api/src/modules/ai/privacy.ts`                                                                                           |
| Usage, privacy, preference, data routes                     | `apps/api/src/modules/ai/controls.ts`                                                                                          |
| Data registry                                               | `apps/api/src/modules/ai/data-registry.ts`                                                                                     |
| Reading chat text for one member                            | `apps/api/src/modules/ai/context.ts`                                                                                           |
| Bot, memory, topics, follow-ups                             | `bot.ts`, `flick-extras.ts`                                                                                                    |
| Writing tools                                               | `compose.ts`, `writing.ts`, `style.ts`, `dates.ts`                                                                             |
| Files and voice                                             | `attachments.ts`, `analyze.ts`, `analyzeModes.ts`, `documentText.ts`, `transcribe.ts`, `transcripts.ts`                        |
| Translation                                                 | `translation.ts`                                                                                                               |
| Understand                                                  | `understand.ts`                                                                                                                |
| Web client                                                  | `apps/web/src/features/ai/`, `features/understand/`, `features/translation/`, `features/productivity/`, `features/grouptools/` |

## Provider chain

`AiChain.fromConfig` builds a fixed list and skips any entry whose key is missing:

1. Anthropic: `claude-sonnet-5-5`
2. Groq account 1: `openai/gpt-oss-120b`, then `openai/gpt-oss-20b`, then `qwen/qwen3.8-27b`
3. Groq account 2: same models
4. Gemini account 1: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`
5. Gemini account 2: same models

Groq and Gemini are called through their OpenAI-compatible endpoints (`api.groq.com/openai/v1`,
`generativelanguage.googleapis.com/v1beta/openai/`). Anthropic uses its own SDK. SDK retries are switched off: the
chain decides what to retry. Reasoning is kept light (`effort: low` on Anthropic, `reasoning_effort: low` on
GPT-OSS and Gemini). When a request asks for JSON, Groq and Gemini get `response_format: json_object`; Anthropic
relies on the prompt. Nothing is logged: prompts, replies and keys never appear in logs.

### Key rotation (two accounts per provider)

The two Groq keys and the two Gemini keys are separate chain entries. When account 1 is rate limited the chain tries
account 2 before moving to the next provider. A bad key or an account without credit marks the whole account as down
for one hour, so its remaining models are skipped.

### Preference: fast or best

`preference` on a request is `quality` (default, order above) or `fast` (Anthropic entries move to the end; the
rest keep their order). The person chooses in Settings ("AI speed": Fast or Best quality) or with the Fast/Smart
pill in the Flick chat; the choice is stored in Redis (`ai:speed:<user>`, no expiry). It is applied by:

| Follows the setting                                                                       | Does not                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flick bot replies, `/ai/compose` (except ghost text, which is always fast), `/ai/analyze` | The package tasks behind `/ai/summarize`, `/ai/translate`, `/ai/suggest-replies` and `/ai/chat`, which never set a preference and always run in quality order; plan, flashcards and the other tools that set nothing |

Some tools always ask for `fast` regardless of the setting: ghost text, actions, poll draft, dictation
clean-up, style-profile refresh, memory extraction, follow-ups. (The compose route overwrites the preference of its
own modes, so simplify and explain code follow the person's setting.)

### Failure handling

Every failed attempt is classified (`errors.ts`). The chain then goes to the next model or entry, sets a cooldown
in Redis (shared by all API replicas), or stops.

| Failure                                                                      | Result label        | What happens                                                                     | Cooldown                                 |
| ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| HTTP 429, normal                                                             | `rate_limited`      | Next entry. If the provider says retry in 2 s or less, retry the same entry once | `retry-after`, else 60 s (that model)    |
| HTTP 429, daily quota text                                                   | `quota_exhausted`   | Next entry                                                                       | `retry-after`, else 1 h (that model)     |
| 401 / 403                                                                    | `auth_error`        | Next entry, skip the whole account                                               | 1 h (account)                            |
| 402, or 400 with credit text                                                 | `credit_exhausted`  | Same                                                                             | 1 h (account)                            |
| 404, or 400/422 saying the model is gone                                     | `model_unavailable` | Next model                                                                       | 1 h (that model)                         |
| 408, attempt timeout                                                         | `timeout`           | Next entry                                                                       | none                                     |
| 5xx                                                                          | `server_error`      | Next entry                                                                       | only if the provider sends `retry-after` |
| Empty answer, or the caller's `validate` fails (for example unparsable JSON) | `invalid_output`    | Next entry                                                                       | none                                     |
| Other 4xx (our own bad request)                                              | `bad_request`       | Stop, return an error                                                            | none                                     |
| Caller cancelled                                                             | `aborted`           | Stop                                                                             | none                                     |
| Every entry failed                                                           |                     | `AiUnavailableError` (HTTP 503)                                                  |                                          |

Time limits: 25 s per attempt and 90 s for the whole walk by default. Individual routes pass tighter limits
(compose 30 s / 45 s, analyze 40 s / 60 s, bot 15 s / 30 s or 30 s / 60 s with a file, follow-ups 10 s / 15 s).
A stream can fall through to the next entry only before its first delta; after that an error event ends it.
The cooldown store fails open: if Redis is down, nothing is treated as cooling.

Metrics: `ai_attempts_total{provider,result}`, `ai_attempt_duration_seconds{provider,result}`,
`rate_limit_rejections_total{scope="ai_user"|"ai_daily"|"flick_bot"}`.

### Capability routing (images and PDFs)

A request is scanned for `image` and `document` parts (`requiredCaps`). Groq models are marked text-only, Anthropic
and Gemini can read images and PDFs. A model that cannot read what the request needs is skipped (it is not an error
and sets no cooldown). If nothing is capable the error is "No configured AI model can read images or PDFs. Add an
Anthropic or Gemini key."

| Input                       | How it reaches the model                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image                       | Server decodes with `sharp`, rotates by EXIF, shrinks to fit 1568 px on the longest side, flattens to white, re-encodes as JPEG quality 82. Source up to 25 MB, result up to 10 MB                                        |
| PDF (model can read PDFs)   | Sent as a base64 PDF document part. Up to 20 MB                                                                                                                                                                           |
| PDF (fallback)              | If no capable provider answered, `/ai/analyze` retries once with the PDF text layer extracted by `pdf-parse`. A scanned PDF has no text layer and fails with "could not read text in this PDF". The bot has no such retry |
| Word `.docx`, Excel `.xlsx` | Text is extracted on the server with `mammoth` and `exceljs` (up to 20 MB), then sent as text                                                                                                                             |
| Text and code files         | Decoded as UTF-8 (up to 1 MB); a file with NUL bytes is refused                                                                                                                                                           |
| Voice note or audio         | Transcribed first with Groq Whisper (up to 25 MB), the transcript goes to the model as text                                                                                                                               |
| Video                       | Not supported ("This file type is not supported yet")                                                                                                                                                                     |

Text from files and transcripts is cut to 60,000 characters before it reaches the model.

## Prompts and untrusted text

Every prompt that contains text written by people puts it in a tag (`<messages>`, `<text>`, `<instruction>`,
`<request>`, `<question>`, `<notes>`, `<items>`, `<file>`, `<transcript>`, `<page>`, `<link>`, `<memories>`,
`<style>`, `<voice>`, `<chat_style>`, `<app_knowledge>`, `<conversation>`). Two defences are applied every time:

1. The code removes any opening or closing copy of that tag from the text (`fence`, `stripTags`), so the text cannot
   close the block and write its own instructions.
2. The system prompt says the block is untrusted data, never to follow instructions inside it, and never to reveal
   the prompt.

Flick has no tools. It cannot send, change or delete anything, so the worst result of an injected instruction is a
bad reply. Pages Flick reads (see [flick-assistant](flick-assistant.md)) and files it opens are fenced the same way.
Output cleaning: compose answers are stripped of code fences and wrapping quotes; JSON answers are parsed and
validated, and anything unusable falls through to the next provider or becomes an error.

## Limits and the two guards

### Rate limits (per minute or per hour)

| Limit                                                    | Value                                                            | Where                     |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| All guarded `/ai/*` routes and `/ai/analyze`, per person | 20 per minute, shared key `ai:user:<id>`, 429 with `retry-after` | `routes.ts`, `analyze.ts` |
| Ghost text (`compose` mode `complete`)                   | 12 per minute                                                    | `routes.ts`               |
| `/ai/translate-batch`                                    | 30 per minute                                                    | `translation.ts`          |
| `/flick/followups`                                       | 20 per minute                                                    | `flick-extras.ts`         |
| Memory extraction                                        | 10 per hour                                                      | `flick-extras.ts`         |
| Bot in a group                                           | 5 per person and 10 per conversation per minute                  | `bot.ts`                  |
| Bot in the Flick chat                                    | 20 per person and 20 per conversation per minute                 | `bot.ts`                  |

Limiters are Redis fixed windows and fail open when Redis is down.

### Central daily quota guard

`AI_DAILY_LIMIT` (default 200) requests per person per UTC day. It is counted in Redis (`ai:quota:<user>:<date>`, with a
per-feature hash for the usage page, both kept 3 days). The check runs in the `guard` pre-handler that covers every
route registered in the `/ai` scope, so any route added there later is counted. Order inside the guard:

1. AI not configured: 503.
2. Daily quota: over the limit gives 429 "Daily AI limit reached (200). Resets at midnight UTC". The counter is
   increased first, so a request refused later (AI off for the chat, minute limit) still uses one request.
3. If the body names a `conversation_id` and the person switched AI off for it: 403 "AI is turned off for this chat".
   (`POST /ai/translate` now takes an optional `conversation_id`, so this applies to it when the app sends it.)
4. Per-minute limit.
5. For summarize, suggest-replies and chat: membership check and loading of chat text.

Counted (feature name shown on the usage page is the route name): summarize, suggest-replies, translate, chat,
compose, understand, style-profile, chat-style, persona, actions, plan, poll-draft, flashcards, dictate, and `analyze`
and `flick_bot` (counted by their own code). Every route in the scope counts, including plain reads such as
`GET /ai/persona`.

Counted by their own code, outside the guard (they live in other modules): `POST /ai/transcribe` (feature
`transcribe`, only when Whisper is really called; a stored transcript returned as is is free), `POST
/ai/translate-batch` (feature `translate-batch`, one per call that reaches the model, cache hits are free) and
auto-transcribe (feature `transcribe`, charged to the member it is for). These three check the per-chat switch first,
so a refused request costs nothing.

Not counted in the daily quota: `GET` and `PUT /ai/transcript/*`, auto-translate and transcribe preferences, `/flick/*`
(memories, topics, resume, feedback, follow-ups), memory extraction after a bot reply, voice summary lines,
`/conversations/:id/group-ai`, `/ai/link-check`, `/productivity/*`, and the usage, privacy, preference and data
routes. The Redis quota fails open: if Redis is down, requests are allowed.

### Per-chat privacy guard

"Allow Flick to read this chat" is a row in `ai_chat_privacy` (default allowed). Every function that reads chat text
for AI goes through `loadLines` in `context.ts`, which calls `assertAiAllowed` first, so a chat with AI off cannot be
read by summarize, replies, Ask Flick context, understand, compose reply mode, flashcards, group tools or the bot.
`loadLines` also enforces that the caller is an active member, hides expired and "deleted for me" messages, and hides
anything from before the person joined. The guard additionally refuses any `/ai` request whose body names a chat with
AI off, and `/ai/analyze` refuses files that were sent in such a chat. Outside `loadLines` the switch is also checked by
`POST /ai/transcribe`, `GET` and `PUT /ai/transcript/*`, auto-transcribe (`transcribeOwner`), `POST /ai/translate-batch`
(which now requires `conversation_id`), and the two places that read your own sent messages for tone: `loadStyleSample`
(`style.ts`) and the style-profile refresh (`writing.ts`) both leave out chats you switched off. Details in
[privacy-and-limits](privacy-and-limits.md).

## Data registry (my AI data)

`data-registry.ts` lets a module register a cleaner (delete a person's data) and an exporter (return it as JSON).
`GET /ai/data` and `DELETE /ai/data` call all of them.

| Registered by            | Export key                                                                                                                 | Cleaned                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `controls.ts` (built in) | `settings` (chat privacy rows, speed), `usage_today`                                                                       | `ai_chat_privacy` rows, speed, today's per-feature counts (the daily total is kept)                                 |
| `writing.ts`             | `writing`: style summary, persona, chat styles                                                                             | `ai_style_profiles`, `ai_chat_style`                                                                                |
| `flick-extras.ts`        | `flick_assistant`: memories, topics, ratings                                                                               | `ai_memories`, `ai_topics`, `ai_feedback`                                                                           |
| `translation.ts`         | `translation`: transcripts you authored or edited, auto-translate per chat, auto-transcribe per chat, translation settings | `message_transcripts` where `author_id` is you, `auto_translate_prefs`, `chat_transcribe_prefs`, `transcript_prefs` |

Not in the registry: the 7-day Redis translation cache, transcripts made for someone else's request, and the
messages of the Flick chat (cleared separately with "Clear my chat with Flick").

## How answers are shown in the app

The server returns model text as markdown. The web app draws it formatted (`features/content/richText/Markdown.tsx`,
which uses the same safe parser as chat bubbles and never injects raw HTML) for: Explain and file answers, summaries,
Ask Flick, catch-up and other understand cards, saved answers and notes, group tool cards, memory facts, study cards,
edit history and the profile About line. One-line places strip the markdown instead (`stripMarkdown`, with
`hasMarkdown` to decide whether a preview is worth drawing): the chat list preview and drafts, notification text, push
body, search snippets, pinned and starred bars, calendar titles. Copy buttons still copy the original text. Streaming
(SSE, `meta` / `delta` / `done`) reaches the screen only in the header Ask Flick and Summarize panels; the bot's replies
arrive as whole messages.

## Endpoints

All need login. Errors use the app error body, or `{ error, message }` from the package routes.

### Package routes (`@chat/ai`, mounted under `/ai`)

| Route                      | Request                                                           | Response                                | Notes                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ai/status`           | none                                                              | `{ enabled }`                           | `false` when no key                                                                                                              |
| `POST /ai/summarize`       | `{ conversation_id }`                                             | JSON `{ text, provider, model }` or SSE | Server loads up to 200 unread messages (1,500 chars each, 40,000 total); with nothing unread, the latest 30                      |
| `POST /ai/suggest-replies` | `{ conversation_id }`                                             | `{ replies: [3], provider, model }`     | Last 15 messages (500 chars, 8,000 total), plus a line on how you write. JSON only                                               |
| `POST /ai/translate`       | `{ text (max 5,000), targetLang, conversation_id? }`              | `{ text, provider, model }` or SSE      | Text comes from the client; the chat id (optional) lets the chat's AI switch apply                                               |
| `POST /ai/chat`            | `{ messages (1-30, 8,000 chars each), conversation_id?, stream }` | JSON or SSE                             | Optional chat context: 200 messages, 300 chars each, 7,000 total. Adds reply language, persona and app knowledge as a first turn |

SSE events: `meta` (provider, model), `delta` (repeated), `done`, or `error` after the first byte.

### Compose and writing

| Route                                      | Request                                                                                                                                              | Response                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /ai/compose`                         | `{ mode, text, ... }` with mode `polish`, `rewrite`, `write`, `refine`, `reply`, `tone`, `cleanup`, `simplify`, `bullets`, `bio`, `code`, `complete` | `{ text, provider, model }`                          |
| `POST /ai/dictate`                         | `{ audio (base64, max 8,000,000 chars), mime }`                                                                                                      | `{ text }`                                           |
| `POST /ai/actions`                         | `{ text (1,000), now, tz_offset_min }`                                                                                                               | `{ actions: up to 8 }`                               |
| `POST /ai/plan`                            | `{ text (500), now, tz_offset_min, conversation_id? }`                                                                                               | `{ title, slots (up to 5), invitation, busy_count }` |
| `POST /ai/poll-draft`                      | `{ text (500) }`                                                                                                                                     | `{ question, options (2-10) }`                       |
| `POST /ai/flashcards`                      | `{ conversation_id }` or `{ text (12,000) }`                                                                                                         | `{ cards (up to 20), quiz (up to 10) }`              |
| `GET, POST /ai/style-profile`              | none                                                                                                                                                 | `{ summary, updated_at }`; POST rebuilds it          |
| `GET, PUT /ai/chat-style/:conversation_id` | `{ style: none/formal/casual/friendly/custom, custom? }`                                                                                             | same                                                 |
| `GET, PUT /ai/persona`                     | `{ persona: default/concise/friendly/formal/tutor, language?, level? }`                                                                              | same                                                 |

### Understand, files, voice, translation

| Route                                            | Purpose                                                                                                    | Page                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /ai/understand`                            | modes `catchup`, `topics`, `recap`, `check`, `search`                                                      | [conversation-understanding](conversation-understanding.md)       |
| `POST /ai/analyze`                               | explain one or more files; modes `table`, `translate`, `highlight`, `compare`, `receipt`                   | [files-images-voice](files-images-voice.md)                       |
| `POST /ai/transcribe`                            | Groq Whisper on a voice note or audio file (videos refused with 400); optional `language` to re-transcribe | [translation-and-transcription](translation-and-transcription.md) |
| `GET, PUT /ai/transcript/:attachment_id`         | read or correct a saved transcript                                                                         | same                                                              |
| `POST /ai/translate-batch`                       | many messages at once, cached 7 days per message; needs `conversation_id`                                  | same                                                              |
| `GET, PUT /ai/auto-translate/:conversation_id`   | per-chat auto translate                                                                                    | same                                                              |
| `GET, PUT /ai/transcribe-prefs/:conversation_id` | per-chat auto transcribe                                                                                   | same                                                              |
| `GET, PATCH /ai/translation-settings`            | auto transcribe, words never to translate                                                                  | same                                                              |

### Controls

| Route                                   | Purpose                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `GET /ai/usage`                         | `{ used, limit, resets_at, by_feature[] }` for today (UTC) |
| `GET, PUT /ai/privacy/:conversation_id` | `{ allow }`; PUT needs membership (404 otherwise)          |
| `GET, PUT /ai/preference`               | `{ speed: fast or quality }`                               |
| `GET /ai/data`                          | download all AI data as JSON                               |
| `DELETE /ai/data`                       | clear it (204)                                             |

### Flick assistant extras (outside the quota scope)

`GET, POST, DELETE /flick/memories`, `PATCH, DELETE /flick/memories/:id`, `GET, POST /flick/topics`,
`PATCH /flick/topics/:id`, `POST /flick/topics/:id/resume` (20 per minute; continues an older topic), `POST /flick/feedback`,
`POST /flick/followups`. See [flick-assistant](flick-assistant.md).

### Other AI callers

`POST /conversations/:conversation_id/group-ai` (tasks `mood`, `icebreaker`, `itinerary`, `flag`),
`POST /ai/link-check`, and the `/productivity/*` routes (ask saved, meeting notes, digest and others) call the same
chain directly. See [productivity-and-safety](productivity-and-safety.md). The @flick bot is not an HTTP route: the
outbox dispatcher calls `flickBotOnMessage` after delivering a message.

## Config variables

| Variable                                       | Default      | Meaning                                                                                                                 |
| ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                            | none         | Anthropic key                                                                                                           |
| `GROQ_API_KEY_1`, `GROQ_API_KEY_2`             | none         | Groq accounts; also used for Whisper (first one set)                                                                    |
| `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`         | none         | Gemini accounts                                                                                                         |
| `AI_DAILY_LIMIT`                               | 200          | Requests per person per UTC day                                                                                         |
| `AI_ATTEMPT_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS` | 25000, 90000 | Read by the package config schema, but `createAiService` passes only the five keys, so the API always uses the defaults |

All keys are optional. A blank value counts as unset.

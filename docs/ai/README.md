# AI in Flick: overview

Flick has one AI layer that serves many features: a chat bot called Flick, writing tools in the message box,
chat understanding (catch-up, topics, recap), file and voice reading, translation, and a few productivity and
group tools. All text features go through one provider chain (Anthropic first, then Groq, then Gemini). Speech
to text uses Groq Whisper. Without any API key the app still works as a normal chat; AI buttons are hidden or
disabled and the AI routes answer HTTP 503. This page is the map. Each feature has its own page with what it does,
how to use it, which endpoint and files implement it, its limits, and an honest Status line.

## Related

- [Architecture](architecture.md): provider chain, fallback, quota guard, privacy guard, endpoint table, config
- [Privacy and limits](privacy-and-limits.md): quota, usage page, no-AI mode, data export and clear, what leaves the server
- [Writing assistant](writing-assistant.md): "Describe your message", polish, tone, ghost text, dictation, personas, study helper
- [Flick assistant (the bot)](flick-assistant.md): direct chat, group mention, memory, topics, voice, links
- [Conversation understanding](conversation-understanding.md)
- [Files, images and voice](files-images-voice.md)
- [Translation and transcription](translation-and-transcription.md)
- [Productivity and safety](productivity-and-safety.md)
- [Feature map](feature-map.md): every feature in one table
- [Decision record 0014: provider fallback chain](../decisions/0014-ai-provider-fallback-chain.md)
- [Feature index page](../features/ai.md)

## What AI does in Flick, by place in the app

| Where you are | AI feature | Page |
| --- | --- | --- |
| Chat with Flick (top of chat list) | Full assistant: answers every message, remembers facts, topics, voice, read aloud | [flick-assistant](flick-assistant.md) |
| Any group | Type `@flick question` or reply to a Flick message; Flick answers in the chat | [flick-assistant](flick-assistant.md) |
| Chat header, sparkle button ("Ask Flick") | Summarise unread, ask a question with or without the chat as context | [flick-assistant](flick-assistant.md) |
| Message box, "Write with Flick" (Ctrl/Cmd+J, `/flick`) | Describe a message, refine, reply, tone, dictation, plan, do-it-for-me, study | [writing-assistant](writing-assistant.md) |
| Message box, other helpers | Suggest replies, selected-text polish, ghost text, tone hint | [writing-assistant](writing-assistant.md) |
| Chat, catch-up card and understand tools | Catch-up, topics, recap, check, search | [conversation-understanding](conversation-understanding.md) |
| A photo, PDF, text file or voice note | "Explain with Flick", extract table, receipt, compare, translate | [files-images-voice](files-images-voice.md) |
| A message bubble | Translate, auto-translate, voice transcript | [translation-and-transcription](translation-and-transcription.md) |
| Saved messages, group tools, link check | Ask saved, digest, mood, icebreaker, itinerary, link check | [productivity-and-safety](productivity-and-safety.md) |
| Profile | "Write my bio" | [writing-assistant](writing-assistant.md) |
| Code block in a message | "Explain" the code | [writing-assistant](writing-assistant.md) |
| Settings, "Flick assistant" card | Usage today, speed, persona, reply language, tone check switch, download and clear AI data | [privacy-and-limits](privacy-and-limits.md) |
| Chat menu | "No-AI mode" for that chat | [privacy-and-limits](privacy-and-limits.md) |

## Providers, models and keys

| Provider | Models (tried in this order) | Env variable | Reads images and PDFs | Used for |
| --- | --- | --- | --- | --- |
| Anthropic | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` | yes | All text features; first in "Best quality" mode |
| Groq account 1 | `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` | `GROQ_API_KEY_1` | no (text only) | Text features; first in "Fast" mode. Also all Whisper speech to text |
| Groq account 2 | same three models | `GROQ_API_KEY_2` | no | Spare account when account 1 is rate limited |
| Gemini account 1 | `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite` | `GEMINI_API_KEY_1` | yes | Fallback; can read images and PDFs |
| Gemini account 2 | same three models | `GEMINI_API_KEY_2` | yes | Spare account |
| Groq Whisper | `whisper-large-v3-turbo` (and `whisper-large-v3` for Indian languages) | `GROQ_API_KEY_1`, else `GROQ_API_KEY_2` | n/a | Voice notes, dictation, hold to talk. Not part of the chain |

Other setting: `AI_DAILY_LIMIT` (default 200 requests per person per UTC day). It is read in `apps/api/src/config.ts`
and is not listed in `.env.example` or `render.yaml`.

## How to turn AI on

1. Put at least one key in the API environment (`.env` locally, the service environment on Render): `ANTHROPIC_API_KEY`,
   `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GEMINI_API_KEY_1` or `GEMINI_API_KEY_2`. Restart the API.
2. `GET /ai/status` now returns `{ "enabled": true }` and the web app shows the AI buttons.
3. For voice (dictation, hold to talk, voice notes, transcripts) a Groq key is needed. For images and PDFs an
   Anthropic or Gemini key is needed. File reading also needs file storage (S3 settings) to be configured.

## What happens with no keys

| Thing | Behaviour |
| --- | --- |
| `GET /ai/status` | `{ enabled: false }`. The web app hides "Write with Flick" and the Flick chat tools; "Suggest replies" and the Ask Flick panel show "AI is not set up on this server" |
| `/ai/*` routes behind the guard | HTTP 503, message "AI is not configured. Set ANTHROPIC_API_KEY, GROQ_API_KEY_1, ..." |
| Flick bot | Stays silent (no reply, no notice) |
| Welcome message | Still posted (it is plain text, not AI) |
| Transcribe, dictate | 503 "Transcription is not configured." when no Groq key |
| Memory page and topics | Still work (plain database features). Persona, chat style and style-profile routes sit behind the guard, so they answer 503 |

If keys exist but every provider fails, requests return 503 "All AI providers are unavailable" and the bot posts one
short notice: "Flick is unavailable right now. Please try again later."

## Honest status of the AI layer

| Area | Status | Gap |
| --- | --- | --- |
| Provider chain, fallback, cooldowns | Built | Cooldown timeouts are fixed in code; `AI_ATTEMPT_TIMEOUT_MS` and `AI_TOTAL_TIMEOUT_MS` exist in the package but the API does not pass them, so defaults (25 s, 90 s) apply |
| Token streaming | Partial | Only "Ask Flick" and "Summarize unread" in the chat header panel stream text as it arrives. The bot's chat replies and every other tool arrive whole |
| Daily quota, privacy switch, data export/clear | Built | Transcription and batch translation are now counted and respect the per-chat switch; a few routes (follow-up chips, memory extraction, group tools, link check, productivity) are still not counted, and the translation cache is not in the data export; see [privacy-and-limits](privacy-and-limits.md) |
| Image description | Partial | Needs an Anthropic or Gemini key. Groq models are text only |
| Video files | Not built | Video is not analysed or transcribed |
| Markdown display | Built | Model answers are drawn formatted (headings, lists, bold, links); one-line previews strip the markdown. See [architecture](architecture.md) |
| Cost control | Partial | No spend cap; only the request count per person per day |

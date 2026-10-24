# Flick: AI assistant and the @flick bot

Code: `packages/ai` (provider chain), `apps/api/src/modules/ai/` (routes and bot),
`apps/web/src/features/ai/` (UI). Decision record: [ADR-0014](../decisions/0014-ai-provider-fallback-chain.md).

## What users get

- **Ask Flick** (sparkle button in the chat header): ask a question, optionally with the chat's last messages as context.
- **Summarize unread**: bullet summary of the messages you have not read (or the latest 30 if nothing is unread).
- **Suggest replies**: three short replies as chips; clicking one fills the composer, it does not send.
- **Translate**: on a text message, pick a language.
- **@flick in a chat**: Flick answers in that conversation as a bot user, with a "Flick" badge.

## Providers and fallback

The chain is fixed: Anthropic (Sonnet), Groq account 1, Groq account 2, Gemini account 1, Gemini account 2.
Each Groq/Gemini account tries its models in order. An entry without a key is skipped.

| Failure                         | What happens                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| rate limit, quota, 5xx, timeout | go to the next entry; rate limit/quota also put the entry on a Redis cooldown (60 s to 1 h) |
| bad key, no credit              | next entry; the whole account is skipped for 1 h                                            |
| our own bad request (other 4xx) | stop and return an error, do not try others                                                 |
| every entry failed              | HTTP 503 (routes); one short notice (bot)                                                   |
| no key configured at all        | HTTP 503 naming the variables; bot stays quiet                                              |

A stream can only fall through before its first token. After that, an error event ends it.
Cooldowns are in Redis so all API replicas share them (see ADR-0005: Redis is never durable).

## HTTP API (all need login)

| Route                      | Body                                     | Answer                     |
| -------------------------- | ---------------------------------------- | -------------------------- |
| `GET /ai/status`           | -                                        | `{ enabled }`              |
| `POST /ai/summarize`       | `{ conversation_id }`                    | JSON `{text,...}` or SSE   |
| `POST /ai/suggest-replies` | `{ conversation_id }`                    | `{ replies: [3 strings] }` |
| `POST /ai/translate`       | `{ text, targetLang }`                   | JSON `{text,...}` or SSE   |
| `POST /ai/chat`            | `{ messages, conversation_id?, stream }` | JSON or SSE                |

JSON is the default; send `Accept: text/event-stream` (or `stream: true` on chat) to stream.
SSE events: `meta`, `delta` (repeated) or `result`, then `done`; a late failure is an `error` event.

Chat text is **never sent by the client**. For summarize, suggest-replies and chat-with-context, the server
reads Postgres for the requesting user only: they must be an active member (otherwise 404, the same as a
conversation that does not exist), they only see messages they could read in the app (no expired or
"deleted for me" ones, nothing from before they joined), and one request carries one conversation.

## The @flick flow

```
user sends "@flick ..."  -> message committed + outbox row
dispatcher delivers message.created, then calls flickBotOnMessage(deps, message)
   skip: sender is a bot / the Flick bot itself, no @flick, AI not configured, already answered
   claim the message in Redis (SET NX) and check no bot reply exists (duplicate delivery)
   rate limit: 5 per user and 10 per conversation per minute (Redis); over the limit -> stay silent
   load the last 20 visible messages for the sender, call the chain ONCE
   ok          -> insert a normal text message from the bot user, reply_to = the mention
   all failed  -> insert "Flick is unavailable right now..." once
   other error -> post nothing
```

The reply uses `allocateSeqAndInsertMessage` with `authorize: false`, so it gets a seq and an outbox row like any
message; devices receive it through the normal pipeline. There is no retry loop. The bot's own message
mentions are ignored, so it cannot answer itself.

## Limits and safety

- Per user: 20 AI requests per minute on the routes. Bot: 5 per user and 10 per conversation per minute.
- Size caps: the context is at most 15-200 messages and 6-40 thousand characters depending on the feature;
  the package also validates every body (128 KiB max) before calling a provider.
- Chat text is untrusted. Prompts wrap it in `<messages>` tags, strip any such tag a sender typed, and tell
  the model not to follow instructions inside it. The bot has no tools, so the worst case is a bad reply.
- Prompts, replies and keys are never logged. Metrics: `ai_attempts_total{provider,result}`,
  `ai_attempt_duration_seconds{provider,result}`, `rate_limit_rejections_total{scope="ai_user"|"flick_bot"}`.
- Privacy: text sent to the AI is processed by Anthropic, Groq or Google. On Gemini's free tier Google may use
  it to improve products. The UI says messages may be processed by an AI provider.

## Config

`ANTHROPIC_API_KEY`, `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2` (all optional).

## Interview notes

- **Why a fallback chain?** Free tiers rate-limit and go down. Falling through, with shared cooldowns, keeps the
  feature up without paying for one big provider. Permanent errors are not retried down the chain.
- **Why does the server load the chat context?** A client could otherwise ask about a chat it is not in, or lie
  about its content. Membership is checked in SQL, once, in one place.
- **How is the bot kept from looping or spamming?** It ignores bots, answers each message once (Redis claim +
  database check, because delivery is at-least-once), and is rate limited per user and per conversation.
- **Why is the bot reply a normal message?** Then ordering, storage, sync, offline delivery and receipts all work
  without special cases.
- **Trade-off:** the bot runs inside the dispatcher's process after delivery; a crash between delivery and the
  reply means no answer (the user can mention again). Acceptable for an assistant; it is not a payment.

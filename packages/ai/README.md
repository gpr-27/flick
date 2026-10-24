# @chat/ai

Server-side AI for the chat platform: a multi-provider fallback chain with shared cooldowns, task helpers
(summarize unread, suggest replies, translate, chat), and a Fastify plugin that exposes them as SSE endpoints.

## Environment variables

Read only through `loadAiConfig()` (zod). Every key is optional: an entry whose key is missing is skipped, and with
no keys at all the routes answer `503 ai_unavailable`.

| Name | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Entry 1: Anthropic (`claude-haiku-5-5`) |
| `GROQ_API_KEY_1` | Entry 2: Groq account 1 |
| `GROQ_API_KEY_2` | Entry 3: Groq account 2 |
| `GEMINI_API_KEY_1` | Entry 4: Gemini account 1 |
| `GEMINI_API_KEY_2` | Entry 5: Gemini account 2 |
| `AI_ATTEMPT_TIMEOUT_MS` | Per-attempt timeout, default `25000` |
| `AI_TOTAL_TIMEOUT_MS` | Budget for the whole chain walk, default `90000` |
| `AI_SMOKE_ENV_FILE`, `AI_SMOKE_ONLY` | Only for `scripts/ai-smoke.ts`: env-file path override; limit to `anthropic`/`groq`/`gemini` |

## Fallback chain

Entries are tried strictly in this order, and each entry's models in order:

1. Anthropic `claude-haiku-5-5` (`@anthropic-ai/sdk`). No `temperature`/`top_p`, no assistant prefill, `effort: low`.
2. Groq #1, `https://api.groq.com/openai/v1`: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`.
3. Groq #2, with the same models.
4. Gemini #1, `https://generativelanguage.googleapis.com/v1beta/openai/`: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`.
5. Gemini #2, with the same models.

Groq and Gemini go through the `openai` SDK. Every SDK runs with `maxRetries: 0`, because the chain owns the retry policy.

| Failure | Action | Cooldown (`retry-after` wins when present) |
| --- | --- | --- |
| 429 with `retry-after` ≤ 2s | retry the same entry once, then fall through | retry-after |
| 429 rate limit | fall through | 60s |
| 429 daily quota (`per day`, `TPD`, `RPD`, `quota_exceeded`, ...) | fall through immediately (never retried) | 1h |
| 401 / 403 | fall through and skip the account's other models | 1h, on every model of that account |
| 402, or a 400 saying "credit balance is too low" | fall through and skip the account's other models | 1h, on every model of that account |
| 404, or a 400/422 saying the model is unavailable or decommissioned | fall through | 1h |
| 5xx / 529 | fall through | none, unless `retry-after` is sent |
| timeout (per attempt, or SDK), network error, 408 | fall through | none |
| empty answer / `validate()` rejected it | fall through | none |
| any other 4xx (our own bad request) | **surface it** as `AiRequestError` and do not try other entries | none |

Cooldown keys look like `ai:cooldown:<provider>:<account>:<model>`, for example `ai:cooldown:groq:1:openai/gpt-oss-120b`.
They are stored behind the `CooldownStore` interface. `RedisCooldownStore` (ioredis, `SET ... PX`) shares cooldowns
across API replicas and fails open; `MemoryCooldownStore` is meant for single processes and tests.

A stream falls through only before its first delta. Once text has reached the client, a failure becomes
`AiStreamInterruptedError`.

## Library API

```ts
import { AiChain, AiTasks, loadAiConfig, RedisCooldownStore } from '@chat/ai';

const chain = AiChain.fromConfig(loadAiConfig(), {
  cooldowns: new RedisCooldownStore(redis, app.log),
  logger: app.log, // pino-compatible
  metrics: { attempt: (l) => aiAttempts.inc(l), latency: (l, ms) => aiLatency.observe(l, ms / 1000) },
});

const r = await chain.complete({ system, messages, maxTokens }, { signal, timeoutMs, totalTimeoutMs });
r.provider; r.model; r.text;

const s = chain.stream(request, { signal });
for await (const delta of s) process.stdout.write(delta);
(await s.info).model;

const tasks = new AiTasks(chain);
await tasks.summarizeUnread([{ sender: 'Asha', text: 'Meet at 5?', sentAt: iso }]);
await tasks.suggestReplies([{ sender: 'Ravi', text: 'Lunch?' }]); // { replies: [a, b, c], provider, model }
await tasks.translate('Hola', 'English');
await tasks.chat([{ role: 'user', content: 'Hi' }]);
// Streaming variants: summarizeUnreadStream, translateStream, chatStream.
```

Errors: `AiUnavailableError` (with `failures[]`), `AiRequestError`, `AiTimeoutError`, `AiAbortedError`,
`AiStreamInterruptedError`.

**Hooks.** Logs carry only provider, account, model, result, status, error type, latency and request id. Prompts,
completions, provider error messages and keys are never logged. `metrics.attempt(labels)` fires once per attempt;
the suggested series name is `ai_attempts_total{provider,account,model,result}`. `metrics.latency(labels, ms)`
records the time to the full answer, or to the first delta for a stream; the suggested series name is
`ai_attempt_duration_seconds`. `result` is one of: `success`, `rate_limited`, `quota_exhausted`, `auth_error`,
`credit_exhausted`, `model_unavailable`, `server_error`, `timeout`, `network_error`, `bad_request`, `aborted`,
`invalid_output`, `skipped_cooldown`, `stream_interrupted`.

## Fastify plugin

```ts
import { aiRoutes, RedisRateLimitStore } from '@chat/ai';

await app.register(aiRoutes, {
  prefix: '/api/ai',
  tasks,
  authGuard: async (req, reply) => { /* verify session, set req.user, or reply.code(401).send() */ },
  rateLimit: { max: 20, windowMs: 60_000, store: new RedisRateLimitStore(redis) }, // per user
  getUserId: (req) => req.user?.id, // default: req.user.id, then req.user.sub, then the IP
});
```

Without `authGuard` the plugin refuses to register unless you pass `allowUnauthenticated: true`.

| Route | Body (zod, capped) |
| --- | --- |
| `POST /summarize` | `{ messages: [{ sender, text, sentAt? }] }`, at most 300 messages, 4,000 characters each, 60,000 in total |
| `POST /suggest-replies` | `{ context: [{ sender, text, fromMe? }] }`, at most 30 messages, 2,000 characters each, 12,000 in total |
| `POST /translate` | `{ text, targetLang }`, text up to 5,000 characters; `targetLang` must be a language name or code |
| `POST /chat` | `{ history: [{ role: 'user' \| 'assistant', content }] }`, at most 40 turns, 8,000 characters each, 32,000 in total; the last turn must be `user` |

Request bodies are limited to 128 KiB.

**SSE stream.** By default the routes reply with `text/event-stream`:

- `event: meta` with `{ provider, model }`
- `event: delta` with `{ text }`, repeated
- `event: done` with `{ provider, model }`

`/suggest-replies` sends `meta`, then `result` with `{ replies: [3 strings] }`, then `done`. A failure after streaming
has started arrives as `event: error` with `{ error, message }`. Before any bytes are sent, failures are ordinary HTTP
errors:

| Status | Body |
| --- | --- |
| 400 | `invalid_request`, with `issues` |
| 429 | `rate_limited`, plus a `Retry-After` header |
| 503 | `ai_unavailable` |
| 504 | `ai_timeout` |
| 422 | `ai_request_rejected` |

With `Accept: application/json`, each route instead returns a single JSON body: `{ provider, model, text }`, or
`{ provider, model, replies }` for `/suggest-replies`. If the client disconnects, the provider call is aborted.

**Privacy.** On the free tier, Google may use prompts sent to Gemini to improve its products. The web app's consent
dialog must cover this before any AI feature is used.

## Scripts

- `npm run build | typecheck | lint | test`. Tests run in Vitest against mocked SDKs and never touch the network.
- `npm run smoke` runs `scripts/ai-smoke.ts`: one real `complete()` through the chain using the repo-root `.env`.
  It prints which entries failed (result and status only), who answered, and the first 80 characters. Keys are
  never printed. It is not part of CI.

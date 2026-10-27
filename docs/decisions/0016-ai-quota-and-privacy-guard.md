# ADR-0016: AI daily quota and the per-chat privacy guard

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0005, ADR-0014, ADR-0017, ADR-0023

## Context

AI keys are free-tier or paid per request, and Flick uses AI in many places. Without a limit one user (or a loop in the
client) could use up every provider's quota for everyone. Separately, people expect to control which chats an AI may
read: a message in a private chat must not reach a model unless the person agrees.

## Decision

Every AI request passes two checks in the API before any provider is called.

1. **Daily quota.** Each user gets `AI_DAILY_LIMIT` requests per UTC day (default 200). The count is a Redis key
   `ai:quota:<user>:<yyyy-mm-dd>` (`INCR`, 3-day expiry) with a second hash per feature, so the Settings page can show
   "used / limit, resets at midnight UTC, by feature" (`GET /ai/usage`). Over the limit the route answers 429 with
   "Daily AI limit reached (N). Resets at midnight UTC". A per-minute limiter (20 requests per user) runs as well. If Redis is down the
   quota **fails open** (the minute limiter and the providers' own limits still apply).
2. **Privacy guard.** "Allow Flick to read this chat" is on by default and can be switched off per chat
   (`ai_chat_privacy`, one row only when the person changed the default). Any route that would send text from that
   chat to a model first calls `assertAiAllowed`; when it is off the answer is 403 "AI is turned off for this chat" and
   nothing is sent. The same switch hides AI buttons in the web UI.

   The switch is enforced on every path that reads a chat, not only the main AI routes: the writing-style samples
   (what the API reads to learn how a person writes in that chat), the Whisper transcription route, the translate and
   translate-batch routes, conversation understanding, the @flick bot, and the background jobs (auto-translate and
   auto-transcribe skip a chat whose switch is off).

What the quota counts: every route under `/ai/*` takes one unit, and so do the places that call a model outside those
routes: `analyze`, `transcribe` (both a person's request and the automatic transcription job, which is charged to the
sender), `translate-batch` and the `flick_bot` replies. The per-feature counts are what Settings shows.

Also part of the guard:

- Chat text and file contents go to the model **fenced** (inside tags) with a rule not to obey instructions found
  inside them (see [`../security/auth.md`](../security/auth.md)).
- Prompts and completions are never logged. Logs carry provider, model, result and latency only.
- A person can export or erase their stored AI data (`GET` and `DELETE /ai/data`), clear the Flick chat, and edit or
  clear Flick's memories. Each module that stores something about AI use registers a cleaner and an exporter in
  `data-registry.ts`, so the buttons cover Flick memories, topics and ratings, the writing style and chat styles, the
  transcripts a person caused (`message_transcripts.author_id`, migration 0034) and their translation and transcription
  settings. The server-side translation cache is not part of the export yet.
- AI runs only when the user asks (or @mentions Flick). See ADR-0023.

## Alternatives

- **No quota, rely on provider limits.** One heavy user would take everyone's capacity, and errors would look random.
- **Quota in Postgres.** Durable, but a write on every AI call for a number that can safely be lost.
- **Global privacy switch only.** Too coarse: people want AI in one chat and not in another.

## Trade-offs

The quota is per user, not per provider: it protects fairness, not the provider limits (the chain's cooldowns do that).
Failing open means a Redis outage removes the daily cap for a while. Counting "requests" rather than tokens is simple
but treats a one-line translation and a long summary the same.

## Consequences

- Web UI shows remaining quota and a clear "limit reached" message.
- Tuning is one environment variable (`AI_DAILY_LIMIT`).
- Docs: [`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md).

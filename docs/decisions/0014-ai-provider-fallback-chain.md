# ADR-0014: AI provider fallback chain, and the @flick bot

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0005, ADR-0011, ADR-0016 (quota and privacy guard), ADR-0017 (multimodal routing), ADR-0023 (heuristics first)

## Context

Flick has an opt-in AI layer (summaries, reply suggestions, translation, writing help, transcription, file and image explanation, conversation understanding, group and productivity helpers, and a Flick assistant chat) and an **@flick** bot: when someone
mentions @flick in a chat, the bot answers in that conversation as a bot user. Most keys are free tiers with tight
limits and occasional outages.

## Decision

Requests go through an ordered chain: Anthropic Sonnet first, then Groq (two accounts, several models), then Gemini
(two accounts, several models).

- A provider that fails with a rate-limit, quota or 5xx error goes on a **Redis cooldown**, and the next one is tried.
- Permanent errors (bad request) are not retried down the chain.
- Each attempt has a 25 s timeout and the whole walk 90 s (`AI_ATTEMPT_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`).
- Providers without a key are left out. With no keys the feature reports "unavailable". It is never faked.
- Prompts and outputs are never logged.
- The bot reply goes through the normal send path, so it is stored, ordered and delivered like any message.

## Alternatives

- **One provider:** unreliable on free tiers.
- **A router service:** another dependency that sees the content.
- **A local model:** too heavy.

## Trade-offs

Answer style varies by provider. Model names change, so the chain is configuration. Cooldowns in Redis are lost if
Redis is lost, which only costs a few extra failed attempts.

## Consequences

- One small interface, one adapter per vendor, one chain runner. The code is in `packages/ai`.

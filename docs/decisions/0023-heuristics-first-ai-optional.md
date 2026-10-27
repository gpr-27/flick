# ADR-0023: Heuristics first, AI optional and only on request

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0014, ADR-0016

## Context

Some features look like AI: warning about a scam link, noticing a tense mood, spotting a promise in a message, sorting a
chat into a category. They run on every message a person reads. Sending every message to a model would be slow, costly,
unavailable offline and a privacy problem.

## Decision

- Features that run **continuously** use local rules in the browser (`apps/web/src/features/safety`, `understand`,
  `productivity`): scam and phishing patterns, link safety, impersonation checks, mood and tone hints, "you promised to..."
  nudges, and a suggested folder or tag for a chat, guessed from the chat's name (`lists/sortRules.ts`). No message text leaves the device for these.
- A model is used only **when the user asks**: pressing a button ("explain", "summarise", "translate", "check this link
  with AI", "why did Flick say this"), typing to Flick, or mentioning @flick. The local result can offer an "ask AI for a
  second opinion" action, but never calls it by itself.
- Nothing is sent to a model from a chat whose AI switch is off (ADR-0016), and every AI call counts against the daily
  quota.
- When no provider is configured the local features still work and AI buttons explain "not configured".
- Local detectors favour few false alarms: they show a banner the person can dismiss, they never block sending or delete.

## Alternatives

- **Model for everything.** Better recall, but cost, latency and privacy are all worse, and it would fail without keys.
- **No detection.** Misses easy wins like obvious scam links.

## Trade-offs

Rules are less clever than a model and need maintenance (new scam wording). Because they run on the client they cannot
protect a person using an old cached build until the app updates.

## Consequences

- AI usage stays predictable, so the daily limit of 200 requests lasts a normal day.
- Docs: [`../ai/productivity-and-safety.md`](../ai/productivity-and-safety.md), [`../features/safety-and-privacy.md`](../features/safety-and-privacy.md).

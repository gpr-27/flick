# AI features (index)

Flick's AI features are documented in [docs/ai](../ai/README.md). This page is only an index: it says what exists and
points to the page that explains how it works, where AI is used, which model answers, the limits and the fallback.
One provider chain (Anthropic, then Groq, then Gemini) serves all text features; Groq Whisper does speech to text.
With no API key the app works as a normal chat and the AI buttons are hidden.

## Related

- [AI overview and provider table](../ai/README.md)
- [Architecture](../ai/architecture.md)
- [Privacy and limits](../ai/privacy-and-limits.md)
- [Feature map (all AI features in one table)](../ai/feature-map.md)
- [Decision record 0014: provider fallback chain](../decisions/0014-ai-provider-fallback-chain.md)

## Where to read about each feature

| You want to know about                                                                                                                              | Read                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The chat with Flick, `@flick` in groups, Ask Flick panel, memory, topics, voice, links, welcome message                                             | [Flick assistant](../ai/flick-assistant.md)                             |
| "Describe your message", polish, rewrite, tone, ghost text, dictation, Do it for me, plan, poll draft, study helper, style, personas, smart replies | [Writing assistant](../ai/writing-assistant.md)                         |
| Catch-up, topics, recap, check, search                                                                                                              | [Conversation understanding](../ai/conversation-understanding.md)       |
| Explain a photo, PDF, text file or voice note, extract a table or receipt                                                                           | [Files, images and voice](../ai/files-images-voice.md)                  |
| Translate messages, auto translate, voice transcripts                                                                                               | [Translation and transcription](../ai/translation-and-transcription.md) |
| Saved-message questions, digest, group tools, link check                                                                                            | [Productivity and safety](../ai/productivity-and-safety.md)             |
| Providers, fallback, quota, endpoints, config                                                                                                       | [Architecture](../ai/architecture.md)                                   |
| Daily limit, usage page, No-AI mode, download or delete AI data, what text leaves the server                                                        | [Privacy and limits](../ai/privacy-and-limits.md)                       |

## The short version

| Fact             | Value                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Models           | Anthropic `claude-sonnet-5-5`; Groq `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`; Gemini `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`; speech `whisper-large-v3-turbo` |
| Keys             | `ANTHROPIC_API_KEY`, `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2` (all optional)                                                                                               |
| Daily limit      | 200 requests per person per UTC day (`AI_DAILY_LIMIT`), 20 per minute                                                                                                                                        |
| Per-chat privacy | Chat menu, "No-AI mode"; enforced on the server                                                                                                                                                              |
| Your data        | Settings, "Flick assistant": usage, speed, persona, download and clear AI data, "What Flick remembers"                                                                                                       |

The `@flick` bot, "Ask Flick" and the writing tools never act for you: Flick has no tools, so it cannot send,
delete or change anything. Everything it writes goes to the message box or to a reply you can ignore.

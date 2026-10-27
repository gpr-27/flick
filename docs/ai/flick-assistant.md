# Flick assistant (the Flick bot)

Flick is a built-in assistant that every account gets as a chat at sign-up. It answers every message in that chat,
and in any group it answers when you type `@flick` or reply to one of its messages. It also powers the "Ask Flick"
panel in the chat header. Its reply is an ordinary chat message from a bot user, so it syncs, is stored and notifies
like any message. Flick has no tools: it can only write text. It knows how the app works and some live facts about
your account, can remember facts about you, can read a link you paste, and can read an image, PDF, text file or voice
note you send it.

## Related

- [AI overview](README.md)
- [Architecture](architecture.md): provider chain, fencing, quota
- [Privacy and limits](privacy-and-limits.md): No-AI mode, delete memories
- [Writing assistant](writing-assistant.md): personas, `@flick` compose
- [Files, images and voice](files-images-voice.md)
- [Conversation understanding](conversation-understanding.md)
- [Groups](../features/groups.md), [Messaging](../features/messaging.md)
- [Decision record 0014](../decisions/0014-ai-provider-fallback-chain.md)

## Where Flick answers

| Where                                           | What triggers it                                                | Mode   | Context read                                                                   | Reply size                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Your chat with Flick                            | Any message you send (text, or a file with a caption)           | direct | Last 20 messages (500 chars each, 6,000 total) since the current topic started | Up to 900 tokens, cut at 3,000 characters                                          |
| A group or a chat with a person                 | A message that mentions `@flick`, or a reply to a Flick message | group  | Last 20 visible messages (500 chars, 6,000 total)                              | Up to 400 tokens, cut at 1,000 characters; the prompt asks for at most 3 sentences |
| "Ask Flick" (sparkle button in the chat header) | You press Summarize unread or send a question                   | panel  | Optionally the latest 200 messages (300 chars each, 7,000 total)               | Up to 2,048 tokens; streamed                                                       |

In a group, the bot checks the sender of the mention. If that person turned on No-AI mode for the chat, Flick posts
"AI is turned off for this chat. You can turn it on in the chat menu." and reads nothing.

Replying to a Flick message continues the conversation without typing `@flick`.
In `@flick` messages that are not in the Flick chat the bot has no memory, no topics and no link reading; those are
only for the direct chat.

## How the bot works (step by step)

Code: `apps/api/src/modules/ai/bot.ts`, called from the outbox dispatcher after `message.created` is delivered.

1. Skip if the sender is a bot or Flick itself, there is no text or file, or AI is not configured (the bot stays
   silent with no keys).
2. Work out the mode: direct chat with Flick, or group (needs `@flick` or a reply to Flick).
3. Claim the message in Redis (`SET NX`, 1 hour) and check no bot reply exists for it. Delivery can repeat, so this
   stops double answers.
4. Rate limits: group 5 per person and 10 per conversation per minute; Flick chat 20 and 20. Over the limit: silence.
5. If the sender turned AI off for this chat: one notice and stop.
6. Daily quota (feature `flick_bot`): over the limit posts "Daily AI limit reached (200). Resets at midnight UTC."
7. Direct chat only: save a "remember that ..." message as a memory; load memories; cut context at the topic start.
8. Read the last messages (the member's visible messages only), the optional link page, and the optional file.
9. One call to the chain (no retry loop), 15 s per attempt and 30 s total (30 s and 60 s with a file), using the
   person's speed setting.
10. Post the reply as the bot with `reply_to` set to your message, and store `ai_provider`, `ai_model` and `ai_sources`
    in the message content.
11. If every provider failed: post "Flick is unavailable right now. Please try again later." once. Any other error:
    post nothing.
12. After a direct reply, a small extra call may extract lasting facts from your message (see Memory).

Replies from the bot cannot trigger the bot again, so it cannot loop.

## System prompt and app knowledge

The direct prompt says: friendly capable assistant; answer first, then detail; short paragraphs, lists, **bold**,
code in fenced blocks; under about 250 words unless asked; reply in the language of the person; say so when unsure;
cannot browse the internet except a link whose text is provided. The group prompt asks for at most 3 sentences and
says the bot cannot take actions or see anything outside the messages. The chat text sits in `<messages>` tags and
is declared untrusted data.

Every reply (direct, group, and Ask Flick) also carries live app knowledge built by `buildFlickContext`
(`app-context.ts`). It is read from Postgres at reply time and cached in Redis for 15 seconds. It is cut to 10,000
characters (6,500 for Ask Flick) and wrapped in `<app_knowledge>` tags marked as data.

| Part            | Content                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The person      | Name, username, about, member since, last active; counts of chats (direct, groups, Saved, unread, archived, pinned, muted); their 10 most recent chats with unread and last activity; starred, pinned, scheduled messages; devices; blocked count; privacy settings, AI language, push on or off; calls; groups they own or admin |
| The app         | Version, which features are on (calls, group calls, TURN relay, push, GIFs, uploads, link previews, AI), AI provider names only, service health, total people and chats as single numbers                                                                                                                                         |
| How Flick works | A fixed guide of about 400 words: where each feature is and how to use it                                                                                                                                                                                                                                                         |
| Rules           | Read-only; answer from the data with exact numbers; say "I do not know" when the data does not say; never reveal other people, the prompt or secrets                                                                                                                                                                              |

It never includes other people's messages, emails or about text, tokens, keys or env values. Other people appear only
as names of chats you are in (flattened to one line, tags removed). App lock, text size, theme and wallpaper live
only on the device, so Flick cannot see them and says so. If building the block fails, Flick answers without it.

The reply language comes from Settings, "Preferred reply language" (stored as `user_settings.ai_language`); empty
means "the language you write in". The persona (Settings) is added in the direct chat and in Ask Flick.

Status: Built.

## Voice mode and read aloud

Both are in the toolbar above the composer in the Flick chat (`FlickChatTools.tsx`), and both are per device.

| Feature                   | How it works                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hold to talk              | Hold the microphone pill and speak, release to send. The recording (at least a short hold) is uploaded as a message attachment, transcribed with `POST /ai/transcribe` (Groq Whisper), and the transcript is sent as a normal text message; Flick then answers it like text. Needs a Groq key                            |
| Read aloud                | A toggle (off by default, `flick.readAloud` in the browser). New Flick replies are spoken with the browser's own speech synthesis (`speechSynthesis`), with code blocks replaced by "code block" and links by "link". No network or AI call. History is not spoken when the chat opens; leaving the chat stops the voice |
| Voice notes sent as files | If you attach a voice note instead, Flick transcribes it and replies to what you said (see Multimodal)                                                                                                                                                                                                                   |

Status: Partial. It is push-to-talk plus text-to-speech, not a live two-way voice conversation.

## Memory

Flick can keep short facts about you in the Flick chat only.

| Item              | Detail                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save by saying it | A message starting `remember that ...` or `please remember ...` is saved as is (3 to 300 characters) before Flick answers                                                                                                                                                                                                                   |
| Automatic notes   | After a direct reply (not for the explicit remember case), an extra fast AI call looks at your message (if 20 characters or more, at most 10 times an hour) and may save up to 3 lasting facts (name, job, diet, preferences). It is told to skip secrets and payment details. These calls are not shown and not counted in the daily quota |
| Limits            | 200 facts, 300 characters each; duplicates ignored                                                                                                                                                                                                                                                                                          |
| In prompts        | The 20 newest facts are added in `<memories>` tags, marked as data and not instructions                                                                                                                                                                                                                                                     |
| See and edit      | Settings, "What Flick remembers" (route `/memory`): add, edit, delete one, or "Forget everything". API: `/flick/memories`. Also in Download my AI data, and removed by Clear my AI data                                                                                                                                                     |
| Table             | `ai_memories`                                                                                                                                                                                                                                                                                                                               |

Status: Built. Gap: automatic notes happen without asking each time; the only control is deleting facts afterwards.

## Topics

A topic is a fresh context inside the Flick chat. "New topic" (pill above the composer) saves a marker at the next
message number; from then on Flick reads only messages after that marker, and the chat shows a divider with the title
(rename in place). "Topics" opens a list with search, rename, jump to where a topic starts, and Resume. Titles default
to "Topic 1", "Topic 2". Table `ai_topics`, routes `/flick/topics`. Older messages stay visible; Flick just stops seeing
them. Jumping works for messages already loaded in the chat.

**Resume a topic.** In the Topics sheet the newest topic is marked "Current" and every other one "Completed". A
completed topic has a "Resume" button. Pressing it (`POST /flick/topics/:id/resume`, 20 per minute) adds a new marker
titled "Resumed: <old title>" (prefixes do not stack) that points back at the old topic (`ai_topics.resumes_topic_id`,
migration 0033). The new topic shows a "Resumed" badge. When you write in a resumed topic, Flick's prompt gets an extra
block, "Earlier in this topic ...", with what was said in the topic it continues, then the new conversation. Rules:

| Rule             | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Chain            | Follows resumed-from links up to 3 topics back, oldest first; stops at a loop or a missing topic                 |
| Size             | The newest 30 earlier messages, 500 characters each, 6,000 in total; fenced as untrusted chat text               |
| Same topic twice | Resuming the current topic, or double-tapping Resume before anything was said, adds no second marker             |
| Scope            | Direct chat with Flick only; the earlier lines are read through the same member-visible loader and privacy check |

Status: Built. Gaps: jump only reaches loaded messages; the follow-up chips do not read the earlier block (they read the
last 6 messages since the marker).

## Feedback, regenerate and follow-ups

Under the latest Flick answer in the Flick chat:

| Control            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy               | Copies the answer text                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Regenerate         | Sends your previous question again as a new message (so you get a new answer and a new bubble)                                                                                                                                                                                                                                                                                                                                               |
| Thumbs up and down | `POST /flick/feedback`, stored in `ai_feedback` (one rating per message). Used for nothing in the app yet; it is only stored                                                                                                                                                                                                                                                                                                                 |
| Follow-up chips    | Off by default (Settings via the Memory page toggle "Follow-up suggestions"). When on, after a new reply arrives in this session the app calls `POST /flick/followups`, which reads the last 6 messages since the topic start and returns 3 short suggestions (at most 8 words). Tapping one sends it. Fetched only after a new reply, never for old history. Each ask costs an AI call (not counted in the quota, limited to 20 per minute) |

Status: Built. Ratings are stored but not used to change answers.

## Model choice (fast or smart)

The "Fast" or "Smart" pill in the Flick toolbar flips the same preference as Settings, "AI speed". Smart (= `quality`)
tries Anthropic first; Fast tries Groq and Gemini first and Anthropic last. The preference is saved on the server
(`PUT /ai/preference`) and applies to bot replies, compose and file analysis. Each answer carries a small "Answered by
Provider - model" tag unless you turn it off in Settings ("Show the model name").

## Reading links (SSRF-safe fetcher)

In the Flick chat, if your message (without an attached file) contains a link, the bot fetches the first link and
gives the page text to the model so it can summarise or answer from it (`fetch-page.ts`).

| Rule      | Detail                                                                                                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocols | Only `http` and `https`                                                                                                                                                                                                                                                                      |
| Addresses | The host is resolved and every answer is checked: private, loopback, link-local and similar addresses are refused (`isBlockedAddress` from `@chat/link-preview`). The check runs when the socket connects, so DNS tricks and redirects are covered. An IP written in the link is checked too |
| Redirects | Up to 3, each re-checked                                                                                                                                                                                                                                                                     |
| Limits    | 5 seconds, first 1 MB, text, HTML, XHTML or JSON only; scripts, styles and tags removed; the result is cut to 6,000 characters                                                                                                                                                               |
| Prompt    | The text goes in `<page>` tags marked as untrusted internet data; the model is told not to follow instructions inside it                                                                                                                                                                     |
| Failure   | If the page cannot be read, Flick is told to say it could not read the link                                                                                                                                                                                                                  |

Only the first link is read, and only in the Flick chat (not in groups). Status: Built. Gap: pages that need
JavaScript, a login, or are PDFs are not readable.

## Multimodal replies (images, PDF, voice)

Send an image, PDF, text file or voice note to Flick in the Flick chat, or in a group while mentioning it or replying
to it, with a caption as the question. The bot reads the attachment if you own it or are in a chat it was sent to.

| File                               | What Flick gets                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image (JPEG, PNG, WebP, GIF, AVIF) | Shrunk to 1568 px, sent as an image. Needs Anthropic or Gemini; Groq cannot read images                                                                   |
| PDF (up to 20 MB)                  | Sent as a PDF document. Needs Anthropic or Gemini                                                                                                         |
| Text, code, `.docx`, `.xlsx`       | Text extracted on the server (1 MB text; 20 MB office)                                                                                                    |
| Voice note (up to 25 MB)           | Transcribed with Whisper; Flick replies to what was said                                                                                                  |
| Video                              | Not supported; Flick says the type is not supported                                                                                                       |
| No caption                         | Default question per type: describe the image and transcribe visible text; summarise the PDF or file; show the transcript and a summary of the voice note |

If a file cannot be read (too large, wrong type, no storage, no speech found) Flick answers with one short
explanation instead of staying silent. If no capable provider is configured for an image or PDF the bot posts
"Flick is unavailable right now". Unlike the "Explain with Flick" dialog, the bot has no text-layer fallback for PDFs.
Status: Partial (image and PDF need an Anthropic or Gemini key; video not analysed).

## "Why did Flick say this?"

Each bot reply stores `ai_sources` = how many recent messages were read, how many files, and whether app knowledge was
used. A small info icon next to the "Answered by" line opens a note: "Flick used: N recent messages from this chat; N
files you sent; Flick's knowledge of the app and your settings". It lists sources by kind and count, not message
text. Status: Built (a count, not a link to each source).

## Welcome message

At sign-up the account gets its Flick chat and a first message from the bot (`welcome.ts`, called from sign-in): it
greets you by name and lists five things to try. It is a normal message written once (the chat row is locked, so two
devices or retries cannot post it twice); older accounts get it only if their Flick chat exists and is still empty.
The bot never answers it. Under it the web app shows example prompts as chips until you send your first message
("Explain something in simple words", "Help me write a polite message", "Give me a fun fact", "Plan a weekend trip").
It does not need an AI key. Status: Built.

## Ask Flick panel (chat header)

Sparkle button in the chat header. "Summarize unread" produces up to 5 bullets of what you have not read (or the latest
30 messages if nothing is unread) from `POST /ai/summarize`. The question box (`POST /ai/chat`) keeps the last 20 turns
and has a "use this chat" checkbox that adds up to 200 recent messages. Both stream text as it is written (the one place
where token streaming reaches the screen) and show the model tag. The panel notes: "Messages you send here may be
processed by an AI provider." Status: Built.

## Fallback when AI is off or fails

| Situation                              | What the person sees                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No keys on the server                  | The Flick chat tools are hidden; the bot does not answer; the Ask Flick panel says AI is not set up |
| All providers failing                  | One message "Flick is unavailable right now. Please try again later."                               |
| Over the daily limit                   | One message with the limit text                                                                     |
| No-AI mode on                          | One message that AI is turned off for the chat                                                      |
| Rate limited                           | No reply                                                                                            |
| Rate limit of memory or follow-ups hit | Silently skipped                                                                                    |

## Known gaps

| Gap                   | Detail                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| Streaming             | The bot's chat replies arrive as a whole message; only the header panel streams |
| Follow-up chips       | Default off; fetched only after a new reply                                     |
| Image description     | Needs an Anthropic or Gemini key                                                |
| Video                 | Not analysed                                                                    |
| Voice                 | Hold-to-talk plus browser read aloud; not live voice                            |
| Topic jump            | Loaded messages only                                                            |
| Resumed topic context | Capped at 30 earlier messages and 3 chained topics                              |
| Regenerate            | Re-sends your question as a new message instead of replacing the answer         |

# Writing assistant

The writing assistant helps you compose messages. It never sends anything for you: every result is put in the message
box (or shown in a dialog) and you press Send yourself. The main entry is the "Describe your message" bar above the
message box; around it are selected-text polish, ghost text, a tone hint, reply suggestions, dictation, "Do it for me",
a plan assistant, poll drafting, a study helper, style profiles, personas, a profile bio writer and a code explainer.
Most tools call one route, `POST /ai/compose`, with a different `mode`; the rest have their own `/ai/*` route. All of
them need an AI key on the server and use the daily quota ([privacy-and-limits](privacy-and-limits.md)).

## Related

- [AI overview](README.md)
- [Architecture](architecture.md): provider chain, fencing, endpoints
- [Privacy and limits](privacy-and-limits.md)
- [Flick assistant](flick-assistant.md): the bot and persona use
- [Translation and transcription](translation-and-transcription.md): "Translate to" and send-in-language
- [Messaging](../features/messaging.md), [Reminders](../features/reminders.md), [Profile](../features/profile.md)

## Where it lives in the code

| Part                                                                         | Files                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server prompts and compose route                                             | `apps/api/src/modules/ai/compose.ts`, `routes.ts` (the `/compose` handler)                                                                            |
| Style profile, chat style, persona, actions, plan, poll, flashcards, dictate | `apps/api/src/modules/ai/writing.ts`                                                                                                                  |
| Sample of your own messages                                                  | `apps/api/src/modules/ai/style.ts`                                                                                                                    |
| Date parser                                                                  | `apps/api/src/modules/ai/dates.ts`                                                                                                                    |
| Contracts                                                                    | `packages/contracts/src/rest/ai.ts`, `writing.ts`                                                                                                     |
| Web: bar and tools                                                           | `apps/web/src/features/ai/DescribeMessageBar.tsx`, `writing/*`, `SelectionPolish.tsx`, `ToneHint.tsx`, `SuggestReplies.tsx`, `WriteThisWithFlick.tsx` |
| Where they mount                                                             | `apps/web/src/features/chat/components/MessageInput.tsx`                                                                                              |

Common rules for every mode: the server asks the provider chain for text only, strips code fences and wrapping
quotes from the answer, and rejects an empty answer (the chain then tries the next provider). Your text is fenced in
`<text>` or `<instruction>` tags and the model is told it is content to work on, never instructions. Input limit is
65,000 characters (2,000 for a "write" instruction). Output cap is 16,384 tokens at most. The route has a 30 s attempt
and 45 s total limit.

## "Describe your message" bar

**What it does.** Turns a short description ("tell Ravi I will be late, friendly") into a ready message in the box,
then lets you change it with one tap. Like Gmail's "Help me write".

**How to use it.**

1. Open it: the "Write with Flick" item in the message box's extra menu (sparkle pen icon), or press Ctrl/Cmd+J, or
   type `/flick` from the slash menu (anything after `/flick` becomes the first description).
2. Type a description and press Enter (arrow button). The draft appears in the message box.
3. The bar now says "Tell Flick what to change": typing again and pressing Enter edits the draft ("make it shorter
   and add a thanks").
4. Use the chips, Retry, Undo, the version arrows, and "Where the draft goes" to place it.
5. Send the message yourself.

It is hidden in the chat with Flick itself and when `/ai/status` says AI is off.

**Modes of `/ai/compose` and what each does**

| Mode       | Triggered by                                                                             | What the model is told                                                                                                                                                                                                   | Result                                |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `write`    | Typing a description                                                                     | Turn the instruction into a short first-person chat message, same language as the instruction, invent no facts. Your current box text is passed as `<text>` context. Tone and length from the settings popover are added | A draft                               |
| `reply`    | "Reply to this..." chip, or chips Say yes / Decline politely / Ask for time / Say thanks | Write the next message "Me" would send, answering the last message, in your style and the chat language. Reads the last 10 messages (500 chars each, 6,000 total) itself. The chip text is a hint                        | A draft                               |
| `polish`   | Selected-text "Polish", and "Check grammar"                                              | Fix spelling, grammar, punctuation, clarity; keep meaning, tone, voice and language; return unchanged if fine                                                                                                            | Corrected text                        |
| `rewrite`  | Selected-text "Rewrite as" menu                                                          | Rephrase in other words with the same meaning, optionally in a tone                                                                                                                                                      | Rewritten text                        |
| `refine`   | Chips under a draft                                                                      | One action: Formalize, Elaborate, Shorten, Make casual, Make friendly, Fix grammar, Add emojis, Translate to a language, or `custom` (your typed change, max 200 chars)                                                  | New version of the draft              |
| `tone`     | "Check tone" chip, and the tone hint                                                     | Decide if the text may read as harsh or rude; answer `OK` or `NOTE:` plus `SOFTER:`                                                                                                                                      | Note and a calmer version, or nothing |
| `cleanup`  | Dictation                                                                                | Remove fillers, false starts, repeats; fix punctuation; keep wording                                                                                                                                                     | Clean text                            |
| `simplify` | "Simplify" chip                                                                          | Explain in plain, short words a child could follow                                                                                                                                                                       | Simpler text                          |
| `bullets`  | "Bullets to message" chip                                                                | Turn rough notes into one natural first-person message                                                                                                                                                                   | A message                             |
| `bio`      | "Write my bio" in the profile                                                            | At most 140 characters, first person, no hashtags, only facts from the hints                                                                                                                                             | A bio                                 |
| `code`     | "Explain" on a code block                                                                | In at most 6 short lines say what the code does; this is an explanation, not a message                                                                                                                                   | Explanation                           |
| `complete` | Ghost text                                                                               | Next at most 12 words continuing the text                                                                                                                                                                                | A short continuation                  |

**Tone and length (settings popover).** Tone: Casual, Formal, Friendly (the contract also allows shorter and
longer). Length: Shorter, Default, Longer. Stored on the device (`composePrefs`). Sent with `write` and `reply`.
"Shorter" asks for one or two sentences.

**Versions.** Every result is kept as a version in the bar (previous/next arrows). "Undo" puts back what the box held
before Flick wrote. If you edit the box by hand, the next change works on your edit, not on the draft. A result over
65,000 characters is refused with a message. "Where the draft goes" lets you replace the box or insert after your
text when the box already had text.

**Chips and suggestions.** With an empty bar you see "Reply to this..." and four reply chips (only when the chat has
messages from others) and your recent prompts (stored on the device).

**Fallback when AI is off or fails.** Bar hidden when AI is not configured. On failure the bar shows the error
("The assistant is temporarily unavailable", "took too long", or 429 "Daily AI limit reached") and your text is
unchanged. Nothing is lost.

**Model.** Chain order from the AI speed setting. A small "Answered by ..." tag shows the model unless turned off in
Settings.

Status: Built.

## Selected-text polish and rewrite

Select text inside the message box; a small floating "Polish" button appears with a "Rewrite as" menu (the five
tones: casual, formal, shorter, longer, friendly). Only the selection is replaced. Calls `polish` or `rewrite` with
just the selected text. Status: Built.

## Ghost text ("Suggest as I type")

Off by default. Turn it on in the bar's settings popover ("Suggest as I type"; stored in the browser). 600 ms after you
stop typing (8 to 400 characters, not starting with `/` or `@`, not after a new line), the web app calls
`/ai/compose` mode `complete`. The result shows as a grey chip above the message box ("...end of your text" plus the
suggestion). Press Tab (when the box is focused) or tap the chip to accept it. It always prefers the fast models
and has its own limit of 12 per minute; each call also counts in the daily quota. A failed call is silent.

Status: Partial. It is a chip above the box, not inline text inside the box.

## Grammar hints

"Check grammar" chip in the bar: sends the box text once in `polish` mode, compares the result with your text, and
shows "Fix N issues" (applies the corrected text as a new version) or "No issues found". It runs only when you tap it.
There is no always-on grammar underline. Status: Built (on demand).

## Tone check

Two ways, both use mode `tone`:

- "Check tone" chip in the bar: shows a note and a calmer version for the current text.
- Settings, "Flick assistant", "Check tone before sending" (off by default, stored in the browser): 2.5 s after you
  stop typing (at least 12 characters) a yellow note appears above the box if the message may sound harsh, with
  "Calmer: ..." and a button to use it. It never blocks sending and fails silently.

An answer that cannot be parsed counts as "fine". Status: Built.

## Dictation

Microphone chip in the bar's tools row. Tap to start, tap again to stop (it also stops itself after 2 minutes).
The recording is sent to `POST /ai/dictate` (base64, up to 8,000,000 characters; the API route allows about 12 MB).
The server sends the audio to Groq Whisper (`whisper-large-v3-turbo`, using `GROQ_API_KEY_1` or `_2`), then runs the
text through the chain in `cleanup` mode (fillers removed, `fast` preference) and the web app inserts the text at the
end of the box. Needs a Groq key; without it the route answers 503 "Transcription is not configured." There is no
fallback speech-to-text provider. Status: Built.

## "Do it for me"

Type a sentence in the bar such as "remind me Friday 6pm to call mom and message Ravi tomorrow 9am that I will be
late" and tap "Do it for me" (or start the bar text with `/do `). `POST /ai/actions` asks the chain for JSON: up to 8
actions of kind `reminder` or `message`, each with text, a recipient name for messages, and the time words exactly as
you wrote them. The server then turns the time words into a real time with its own deterministic parser
(`dates.ts`: it understands "tomorrow 9am", "Friday 6pm", "in 2 hours", "next week", noon, midnight, 24-hour times;
only a day gives 9:00; anything else gives no time) using your clock and time zone sent in the request. The dialog shows
one card per action. Nothing happens until you confirm; the cards then call the normal reminders and scheduled-message
endpoints. A "message" card goes to the chat whose title matches the name, else the current chat. Status: Built.
Gap: the parser covers common phrases only; an unknown time is left for you to set.

## Plan assistant

"Plan" chip: "plan dinner with Ravi on Friday". `POST /ai/plan` asks the chain for a title, the day words and a
friendly invitation. The server picks up to 5 free time slots around the target time, counting your own pending
reminders and scheduled messages in the next 30 days as busy (it does not read calendars). Picking a slot puts the
invitation, with the time, in the message box. Status: Built. Gap: "busy" only means Flick's own reminders and
scheduled messages.

## Poll drafting

"Poll from question" chip (groups only). `POST /ai/poll-draft` turns a plain question into a question and 2 to 6
options (Yes and No for yes/no questions) and opens the normal poll composer pre-filled; you create the poll
yourself. Fails with "Could not make a poll from that. Try rewording it." if the model returns fewer than 2 options.
Status: Built.

## Bullets to message and simplify

"Bullets to message" (mode `bullets`) and "Simplify" (mode `simplify`) are chips in the bar's tools row; each makes a
new version of the draft. Status: Built.

## Bio writer

In the profile editor, "Write my bio" uses mode `bio` on what is in "About" (or a few hints) and fills a bio of at most
140 characters. Status: Built.

## Explain code

Code blocks in messages have an "Explain" button in the header. It calls mode `code` and shows a short plain-words
explanation (at most 6 lines) under the code. Status: Built.

## Study helper

"Study" chip. Pick this chat or paste notes. `POST /ai/flashcards` sends up to 60 recent messages of the chat
(600 chars each, 10,000 total) or up to 12,000 pasted characters, and the model makes 6 to 12 cards and 3 to 5 quiz
questions with 4 options each. The server validates the JSON (exactly 4 options, an answer index 0 to 3) and drops
bad items. Cards live in the dialog only; nothing is saved. Status: Partial. It works from chat text or pasted text; it
does not take a PDF or other file.

## Style profile and style per chat ("my voice")

- **Style profile.** After you have sent at least 8 text messages, the server asks the model to describe how you write
  (at most 80 words, second person: length, formality, punctuation, emoji, favourite words, languages). It reads your
  last 50 sent text messages from all chats (200 chars each), stores the summary in `ai_style_profiles`, and refreshes
  it in the background when you use `write` or `reply` and it is older than 7 days. You can rebuild it with
  `POST /ai/style-profile`. The summary is added to compose `write`, `reply` and `complete` prompts and to reply
  suggestions inside `<voice>` tags (treated as data).
- **Style for this chat.** In the bar's settings popover: None, Formal, Casual, Friendly or Custom (up to 200
  characters, e.g. "short and teasing"). Stored in `ai_chat_style`; applied automatically whenever Flick writes or
  suggests in that chat.
- **Gap.** The style profile and the sample of your own messages are read from all your chats, including chats where
  No-AI mode is on (see [privacy-and-limits](privacy-and-limits.md)). You can delete both with "Clear my AI data".

Status: Built.

## Replies in your tone (smart replies)

"Suggest replies" button above the message box. `POST /ai/suggest-replies` loads the last 15 messages (500 chars
each) of the chat, adds one line with your style summary and, if present, up to 10 of your recent messages
(120 chars each), and asks for exactly 3 short replies (under 60 characters) as JSON. The server code parses the JSON,
removes duplicates, and rejects the answer (the chain tries the next provider) unless there are 3 distinct replies.
The three replies show as chips; tapping one fills the box, nothing is sent. The button is also joined by "Summarise
chat" when you have 5 or more unread, and a catch-up card at 8 or more (see
[conversation-understanding](conversation-understanding.md)). It runs only on tap. This route uses the package task,
so it ignores the AI speed setting. Status: Built.

## Personas (including language tutor)

Settings, "Flick assistant": a persona list: Default, Concise, Friendly, Formal, Language tutor. A tutor needs a
language and a level (Beginner, Intermediate, Advanced); it tells Flick to reply in simple language of that level, add
a one-line English hint for hard words and gently correct mistakes. Stored in `ai_style_profiles.persona` via
`PUT /ai/persona`. The persona only applies to Flick's own answers in the chat with Flick and to Ask Flick, not to
writing tools or group mentions. Status: Built. Gap: no tutor tools beyond the prompt (no vocabulary lists or
progress).

## `@flick` compose and `/flick`

- In a one-to-one chat with a person (not a group, not Saved messages), if the box holds `@flick <instruction>`, a
  "Write this with Flick" button appears. It calls mode `write` with the instruction and puts the result in the box
  instead of sending the instruction. This works only while the box still starts with `@flick`.
- In a group, `@flick ...` is a real mention: the message is sent and the bot answers in the chat (see
  [flick-assistant](flick-assistant.md)).
- Typing exactly `/flick` (with or without a trailing space) in the box turns into `@flick `. Choosing "/flick" from
  the slash menu instead opens the Describe bar, with anything typed after it as the first description.

Status: Built.

## Known gaps in this area

| Gap                | Detail                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Ghost text         | A chip above the box, not inline                                                 |
| Conflict softening | The tone check only returns a calmer rewrite; there is no separate conflict mode |
| Flick toolbar      | Sits above the composer as a bar, not inside the text box                        |
| Streaming          | Compose results arrive whole, not word by word                                   |
| Speed setting      | Compose follows it, but reply suggestions and translate do not                   |
| Study helper       | Chat text or pasted text only, not PDFs                                          |

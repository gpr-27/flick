# Translation and transcription

Flick turns speech into text (voice notes and audio files, with Groq Whisper) and text into another language (with the language models). Transcripts are saved once per message and shared with everyone in the chat. Translation is on demand for one message, automatic per chat for each reader, or applied before sending ("Send in another language"). Videos are not transcribed or translated.

Related

- [AI overview](README.md), [architecture](architecture.md), [privacy and limits](privacy-and-limits.md)
- [Files, images and voice](files-images-voice.md) ("Explain with Flick" on a voice note, a separate path)
- [Writing assistant](writing-assistant.md) (Describe bar, dictate button)
- [Calls](../features/calls.md), [messaging](../features/messaging.md), [search and organise](../features/search-and-organise.md)
- [Feature map](feature-map.md)

## Models used

| Job                             | Model path                                                                                                                                                                                                                                                                                                     | Code                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Speech to text                  | Groq Whisper `whisper-large-v3-turbo`. If the detected language is an Indian language (Hindi, Urdu, Marathi, Nepali, Punjabi, Bengali, Gujarati, Tamil, Telugu, Kannada, Malayalam, Sanskrit, Assamese) and no language hint was given, it asks `whisper-large-v3` again and keeps that answer if it has text. | `apps/api/src/modules/ai/transcripts.ts`     |
| One-line summary of a long note | The normal provider chain (Anthropic `claude-sonnet-5-5`, then Groq, then Gemini)                                                                                                                                                                                                                              | `transcripts.ts`                             |
| Translation                     | The same provider chain                                                                                                                                                                                                                                                                                        | `translation.ts`, `packages/ai/src/tasks.ts` |
| Language detection for the chip | No model: a local script and common-word guess                                                                                                                                                                                                                                                                 | `apps/web/src/features/ai/languageDetect.ts` |
| Live captions in calls          | Browser speech recognition, no server                                                                                                                                                                                                                                                                          | `apps/web/src/features/platform/captions.ts` |

Speech to text needs a Groq key (`GROQ_API_KEY_1` or `_2`) and file storage. Translation needs any one provider key.

## Voice transcripts

Table: `message_transcripts` (migration 0029): one row per message with `text`, `language`, optional `summary` and a generated full-text `search` column.

### What a transcript is for

- It appears under a voice note in the chat: the summary line (if any), the text and the detected language. Everyone in the chat sees the same transcript.
- It is searchable: chat search matches transcript text and shows it as the snippet (`packages/database/src/queries/messages.ts`).
- It is the caption for the voice note in your language when the chat is auto-translated for you.

### Limits and scope

- Voice notes and audio files only. Audio up to 25 MB (the transcription service's maximum). Above that the API answers 400 "This audio is N MB; the limit is 25 MB ... Try a shorter recording."
- Video messages have no transcript. Both the manual and the automatic path refuse video (`isTranscribable`; message "Videos can't be transcribed. Only voice notes and audio files can."). Extracting the audio track of a video is not built; it is a possible future idea.
- Audio files sent as ordinary files: the API can transcribe them and auto-transcribe handles them, but the transcript box in the app is drawn only under voice notes (`VoicePlayer`). An audio file has no "Transcribe" button, so a transcript of an audio file exists only if auto-transcribe made one; it is searchable but not shown under the file.
- Whisper call timeout is 45 seconds. Errors map to specific messages: busy (429, "Transcription is busy right now. Try again in a minute."), too large (400, with the size and the limit), format not supported (400, "This audio format can't be transcribed."), empty file, timeout, unavailable (503). When nothing was heard the box says "No speech was found in this voice message."
- A video sent as a message is refused with 400 "Videos can't be transcribed. Only voice notes and audio files can." by `POST /ai/transcribe`.

### Manual transcribe

- Where: under a voice note, tap "Transcribe".
- Endpoint: `POST /ai/transcribe` `{ attachment_id, language? }`, then the result is saved and returned as `{ text }`.
- You must be allowed to open the file (uploader or member of a chat it was sent in). If you have switched "Allow Flick to read this chat" off for that chat, the route answers 403 "AI is turned off for this chat" and no audio is sent.
- Daily quota: one request, taken only when Whisper is really called (a saved transcript returned as it is does not count). The server remembers who asked in `message_transcripts.author_id` (migration 0034), which is how "Download / Clear my AI data" finds transcripts you caused.
- If a transcript already exists, it is returned without calling Whisper, unless you pass a language ("Wrong language? Transcribe again as ..."), which transcribes again with that language hint and replaces the saved transcript. Language names the app offers map to ISO codes (English, Spanish, French, German, Portuguese, Hindi, Telugu, Arabic, Japanese, Chinese, Tamil, Kannada, Malayalam, Bengali, Marathi, Urdu, Russian, Korean, Italian).

### Auto-transcribe

- Setting: Settings > "Transcripts and translation" > "Transcribe voice notes automatically" (global, `PATCH /ai/translation-settings`), and a per-chat override in the chat menu: "Auto-transcribe voice notes" (`PUT /ai/transcribe-prefs/:conversation_id`). A chat setting beats the global one. The default is off.
- When it runs: after a voice note or audio file is delivered (never a video), the server transcribes it if a member of the chat has auto-transcribe on for that chat and has not switched "Allow Flick to read this chat" off, then stores it for everyone. It never transcribes the same message twice, skips audio over 25 MB, and allows at most 15 automatic transcriptions per minute per chat.
- The first such member (by join date) is "the member it is for": one request of their daily quota is charged to them. If they are out of quota, there is simply no transcript.
- Because it is a per-member opt-in on the server, one member turning it on makes the transcript visible to the whole chat.
- Voicemail (below) is always transcribed when a Groq key is set, whatever the settings.
- If it does not run (no Groq key, too large, rate limit, no speech), the voice note simply has no transcript and the "Transcribe" button remains. The app asks the server again after 8 and 20 seconds, in case auto-transcribe is still working.

### Summary, edit, copy, share

- Notes longer than 60 seconds get a one-sentence summary (at most 25 words, in the transcript's language), shown above the text. The transcript is cut to 6,000 characters for the summary. If AI is off or the call fails there is no summary and the transcript is still saved.
- Edit: pencil button, then Save. `PUT /ai/transcript/:attachment_id` `{ text }` (up to 20,000 characters). Any member of the chat can edit the shared transcript; the summary is not regenerated. The editor becomes the transcript's `author_id`.
- Copy and Share buttons use the browser clipboard and share sheet.
- Read: `GET /ai/transcript/:attachment_id` returns the stored transcript or null. Both read and edit answer 403 when you have the chat's AI switch off. Neither counts against the daily quota.
- "Wrong language?" (next to the detected language) re-transcribes with the language you pick; this one does count.

## Voicemail

- When you call someone and they miss it, the call log offers to record a voice note that is sent flagged as a voicemail (`voicemail: true`). It shows the label "Voicemail" above the player.
- Voicemails are always auto-transcribed (Groq key needed), so the receiver can read it. Status: Built.

## Translate a transcript

- Under a transcript: a language picker and "Translate to <language>". If there is no transcript yet, it transcribes first, then translates. Long text is split at paragraph or sentence ends into pieces under 3,500 characters (each item of the batch route may carry up to 4,000); if any piece fails the whole translation is dropped rather than shown half done. The pick is remembered in the browser.
- The default language is the chat's auto-translate language, else English, else (when the note is already English) your last pick or Spanish. If the result equals the original it says "This is already in <language>. Pick another language to translate it to." Afterwards a "Show original" / "Show translation" toggle switches the view.
- Status: Built.

## Translating messages

### One message, on demand

- Message menu > "Translate" (text messages only): shows the translation under the message in italics with "Show original". Target language is always the app language, English (`UI_LANGUAGE`). Endpoint `POST /ai/translate` `{ text, targetLang, conversation_id? }` (up to 5,000 characters, streaming or JSON). The app sends the chat id, so the chat's AI switch applies; the daily quota counts it.
- Gap: a "Translate message" dialog with a language picker exists in the code (`TranslateDialog.tsx`) but nothing opens it; the menu item only does the English inline translation.
- Translate chip: under an incoming text message, if the local detector thinks it is written in another language than English, a chip "Translate from <language>" appears and translates to English on tap. The detector knows Telugu, Hindi, Tamil, Arabic, Russian, Chinese, Japanese and Korean by script, and English, Spanish, French and German by common words; otherwise it stays quiet, so other languages never get a chip (the menu item still works).
- If AI is off: the chip is hidden and the menu action shows an error.
- Status: Built, with the picker gap.

### Auto-translate a chat (per reader)

- Where: chat menu > "Auto-translate this chat" (turns on with English) or "Auto-translate (<language>): turn off". Stored per user and chat in `auto_translate_prefs` (`GET/PUT /ai/auto-translate/:conversation_id`).
- Effect: each incoming text message gets its translation shown under it ("Translating..." while waiting). Your own messages are not translated. In a group, each reader picks their own language, so one message can be read in different languages by different people; nothing changes for the sender or other readers.
- A message is skipped when the local detector says it is already in your language.
- How it is fetched: visible messages are collected for 150 ms and sent in batches of up to 20 to `POST /ai/translate-batch` `{ items: [{id, text}], target_language, cache }`. The model gets a JSON array and must return a JSON array of the same length. One failed item comes back as null and just shows no translation.
- Cache: results for message ids are cached in Redis for 7 days per reader and language (`tr:<user>:<language>:<message id>`).
- The request must name the chat (`conversation_id`, required) and you must be a member; if you have switched "Allow Flick to read this chat" off for it, the route answers 403 "AI is turned off for this chat".
- Rate limit: 30 batch calls per minute per user. Daily quota: one request per call that reaches the model; answers found in the cache are free.
- Token budget: scaled by length (4 tokens per character, 1,000 to 8,000) because Telugu, Hindi and other scripts need many tokens.
- Status: Built.

### Don't-translate list

- Settings > "Transcripts and translation" > "Never translate these words". Names, brands and other words you add are replaced by placeholders before the model call and put back after. Stored in `transcript_prefs.dont_translate`.
- Applies to translate-batch (auto-translate and Send in another language). It does not apply to the single-message `POST /ai/translate`.

### Send in another language

- Where: a link "Send in another language" above the composer, shown when the box has text. Pick a language, then press "Send in <language>". It is a chip above the composer, not part of the Describe bar.
- Effect: the draft is translated first; if translation fails nothing is sent ("Couldn't translate. Nothing was sent."). The sent message carries the translation as its text and keeps the original and the language (`original_text`, `translated_to`).
- In the bubble everyone sees the translation. You (the sender) also see a small "Original:" line with what you wrote. Readers get a "Show original (translated to <language>)" toggle, with "Hide" to close it again.
- Uses the same translate-batch route with cache off, and long drafts are split into pieces like a transcript is. It counts against the daily quota and respects the chat's AI switch.
- Gap: translating a draft that is being written in the Describe bar is not built.
- Status: Partial.

### Live captions in calls

- A CC button in 1:1 and group call screens. Your microphone is turned into text by the browser's speech recognition (Web Speech API; Chrome, Edge, Safari, not Firefox) and sent to the other side over the call's data channel. Nothing goes through the Flick server, and no Flick AI is used. The button is hidden where the browser lacks support.
- The captions code can translate the other person's words (`translateTo`), but no screen sets it, so translation of captions has no UI.
- Status: Partial.

## Dictation

- Endpoint: `POST /ai/dictate` `{ audio (base64, up to 8 MB), mime }`. It sends the audio to Groq `whisper-large-v3-turbo`, then asks the chain (fast providers first) to remove fillers and false starts, fix punctuation and keep the language.
- UI: the dictate button in the Describe bar tools inserts the cleaned text. The "hold to talk" button in the Flick chat records a voice note and uses `/ai/transcribe` instead, then sends the words as a text message.
- Limits: this route is inside the `/ai` scope, so it counts against the daily limit and 20 per minute. If Whisper fails it returns 503 "Transcription failed. Try again later."
- Dictation audio is not stored.

## When AI is off or fails

| Case                       | Result                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Groq key                | Transcribe, auto-transcribe, dictation and voicemail transcripts are unavailable (503 "Transcription is not configured."). Voice playback is unaffected. |
| No provider key at all     | Translation features show an error or hide; no summary is made; transcripts still work if Groq is set                                                    |
| Chain fails during a batch | 503 "Couldn't translate right now."; messages just show no translation                                                                                   |
| Whisper busy               | "Transcription is busy right now. Try again in a minute."                                                                                                |

## Privacy

- Audio is sent to Groq for transcription. Text to translate is sent to the provider that answers.
- The per-chat No-AI switch now applies to `/ai/transcribe`, transcript read and edit, auto-transcribe, translate-batch and (when the app sends the chat id) `/ai/translate`. These routes do not read chat history; they work on the audio or text of the item itself, but they stay shut for a chat you switched off. Features that read chat history check it too (see [conversation understanding](conversation-understanding.md)). Details and the quota rules are in [privacy and limits](privacy-and-limits.md).
- "Download my AI data" includes transcripts you authored or edited, your auto-translate and auto-transcribe choices and your translation settings; "Clear my AI data" deletes them. The translation cache is not covered (it expires after 7 days).
- Transcripts are visible to every current member of the chat and are searchable by them. They are deleted with the message (cascade).
- Everything is plain text on the server; there is no end-to-end encryption.

## Known gaps

- Video has no transcript or translation (the server refuses it).
- Audio-file transcripts are stored and searchable but not displayed under the file, and an audio file has no "Transcribe" button.
- The per-message language picker is not wired in.
- Caption translation has no UI.
- Draft translation inside the Describe bar is not built.
- The language chip detector covers a handful of languages.

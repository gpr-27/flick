# Files, images and voice

Flick can read a file that was sent in a chat (a photo, PDF, Word document, spreadsheet, CSV, text or code file, or a voice note) and explain it, pull out a table or a receipt, highlight key terms, translate it or compare two versions. It is one endpoint, `POST /ai/analyze`, behind the "Explain with Flick" menu item and the camera button "Ask Flick about this photo". Video files are not analysed. The share target only takes text.

Related

- [AI overview](README.md), [architecture](architecture.md) (provider chain, caps)
- [Privacy and limits](privacy-and-limits.md)
- [Translation and transcription](translation-and-transcription.md) (stored voice transcripts, a different feature)
- [Feature map](feature-map.md)
- [Media and files](../features/media-and-files.md), [PWA and push](../features/pwa-and-push.md)

## What you can do

| Action                      | Where                                                                     | Mode / endpoint                                   | Status            |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| Explain a file              | Message menu, "Explain with Flick"                                        | `POST /ai/analyze` (default prompt per type)      | Built             |
| Ask a question about a file | Same dialog, "Ask about this file" box                                    | `question`                                        | Built             |
| Quick asks on a photo       | Same dialog: Solve this, Explain this error, What is this?, Read the text | `question` (fixed texts in `fileTools.ts`)        | Built             |
| Extract table               | Same dialog, "Extract table"                                              | mode `table`; copy as CSV or download `table.csv` | Built             |
| Highlight key terms         | Same dialog                                                               | mode `highlight`                                  | Built             |
| Extract receipt             | Same dialog                                                               | mode `receipt`; "Add to Saved messages"           | Built             |
| Translate a file            | Same dialog, language list + "Translate"                                  | mode `translate`                                  | Built             |
| Compare versions            | Same dialog, after adding a second file                                   | mode `compare`                                    | Built             |
| Ask Flick about a new photo | Camera, after taking a photo                                              | uploads, then opens the same dialog               | Built             |
| Reply with the answer       | Dialog, "Reply with this"                                                 | puts the answer in the message box (not sent)     | Built             |
| Ask Flick about shared text | Share page "Ask Flick about this"                                         | `POST /ai/chat`                                   | Built (text only) |

## Where to find it

- "Explain with Flick" is in the long-press / right-click message menu. It shows only when AI is enabled and the message is a photo, a file or a voice note. It does not show for video, GIF, sticker or text messages.
- The dialog starts the default explanation as soon as it opens. The default prompt depends on the type: describe the image and transcribe visible text; summarise a PDF or text file (explain what it does if it is code); show the transcript of a voice note, then a short summary.
- Other photos and files in the same chat are offered as "add to this question". Up to 4 files in total can be asked about together. With several files and no question, Flick compares them.
- The camera shows "Ask Flick about this photo" after you take a photo (not for video, and only when AI is on). It uploads the photo and opens the dialog for the open chat.

## What the server does

Code: `apps/api/src/modules/ai/analyze.ts`, `attachments.ts`, `analyzeModes.ts`, `documentText.ts`.

1. Checks the request (1 to 4 attachment ids, optional question up to 1,000 characters, optional mode and language).
2. Needs AI keys and file storage; otherwise 503 `AI_UNAVAILABLE` ("AI is not configured" or "File storage is not configured").
3. Counts one request against the daily AI limit (200 by default) and the 20 per minute limit.
4. If the file was sent in a chat where you turned on No-AI mode, refuses with 403.
5. Checks you may open the file: you uploaded it, or you are a member of a chat it was sent in. Otherwise it looks like "File not found" (404).
6. Turns the file into model input (table below), wraps text in `<file>` or `<transcript>` tags, and tells the model that file contents are untrusted data and must never be obeyed.
7. Calls the provider chain with 40 seconds per attempt and 60 in total. Your "fast or quality" preference is passed on.
8. Returns `{ text }`. The text is not stored.

## File types, limits and how each is read

| Type                | Detected by                                                                                                                               | Size limit     | How it reaches the model                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Image               | jpeg, png, webp, gif, avif                                                                                                                | 25 MB original | Decoded with sharp, rotated by EXIF, shrunk to at most 1568 px on the long side, flattened on white, re-encoded as JPEG (quality 82); the result must be 10 MB or less. Sent as an image. Animated GIFs are read as one still. |
| PDF                 | `application/pdf`                                                                                                                         | 20 MB          | Sent as a PDF document to a model that can read PDFs. If no such model answers, the server reads the text layer with `pdf-parse` and retries as text.                                                                          |
| Word                | `.docx`                                                                                                                                   | 20 MB          | Text extracted with `mammoth` (raw text).                                                                                                                                                                                      |
| Excel               | `.xlsx`                                                                                                                                   | 20 MB          | Every sheet read with `exceljs`, one block per sheet, rows as CSV-like lines.                                                                                                                                                  |
| Text and code       | `text/*`, JSON, XML, YAML, SQL and common extensions (txt, md, csv, tsv, json, log, html, css, js, ts, py, go, java, c, cpp, sh and more) | 1 MB           | Decoded as UTF-8. A file with NUL bytes is refused.                                                                                                                                                                            |
| Voice note or audio | `audio/*`; a webm, ogg or mp4 container whose file name contains "voice" or "audio"                                                       | 25 MB          | Speech to text with Groq Whisper `whisper-large-v3-turbo` (45 second limit), then the transcript goes to the chain as text.                                                                                                    |
| Anything else       |                                                                                                                                           |                | 415 "Flick can read images, PDFs, text files and voice notes. This file type is not supported yet."                                                                                                                            |

- Text from a file or transcript is cut to 60,000 characters before it is sent.
- Too large: 413 "This file is too large for Flick (limit N MB)".
- Old Office formats (`.doc`, `.xls`, `.ppt`, `.pptx`) and archives are not supported.
- Video files are not analysed. A video is classified as unsupported and the answer is 415. The "Explain with Flick" item is not offered on video messages and the camera hides the button for video.
- A scanned PDF with no text layer works only when a PDF-capable model answers; on the text fallback it fails with "Flick could not read text in this PDF (it may be a scan)".

## Provider routing

- The chain order is Anthropic `claude-sonnet-5-5`, then Groq (two keys, three text models each), then Gemini (two keys, three models each). With the "fast" preference the Anthropic entries go last.
- Groq models here are text only. A request that contains an image or a PDF skips every Groq model and goes to Anthropic or Gemini. Gemini reads images and PDFs through its OpenAI-compatible endpoint as data URIs.
- Text-like files (text, docx, xlsx, PDF text fallback) and voice transcripts can be answered by any provider.
- Voice transcription always needs a Groq key (`GROQ_API_KEY_1` or `_2`), independent of the chat chain.

## Modes

Each mode sends a fixed instruction with the file. The system prompt asks for an answer under about 250 words, in the language of your question or of the file.

| Mode        | Instruction in short                                                                                       | Max answer |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| (default)   | Describe / summarise by type                                                                               | 900 tokens |
| `table`     | Reply with only a markdown table of the main table, or "No table found."                                   | 2,500      |
| `translate` | Translate all text into the chosen language, keep structure                                                | 3,000      |
| `highlight` | Key terms as bullets under Dates, Amounts, Obligations                                                     | 1,200      |
| `compare`   | File 1 is older, File 2 newer: list added, removed, changed. With one file it says a second file is needed | 1,500      |
| `receipt`   | Reply with only JSON: merchant, date, currency, total, items                                               | 800        |

- The browser parses the table (first markdown table) and shows copy-as-CSV and download buttons. Parsing is done locally.
- For a receipt the browser parses the JSON and shows merchant, items and total. "Add to Saved messages" sends a plain text message ("Receipt: Name (date)", item lines, "Total: ...") into your Saved messages chat. It does not attach the photo. If the JSON is not usable, the raw answer is shown instead.
- Translation language is chosen in the dialog from the language list; the default is the first in the list.

## When AI is off or no vision key is set

| Situation                       | What you get                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No AI key at all                | "Explain with Flick" is hidden; API returns 503                                                                                                                                                                                |
| Only Groq keys                  | Text files, docx, xlsx, CSV, voice notes and PDFs that have a text layer work. Images fail with 503 "No configured AI model can read images or PDFs. Add an Anthropic or Gemini key." PDFs without a text layer fail with 415. |
| Anthropic or Gemini key present | All of the above, and images and scanned PDFs                                                                                                                                                                                  |
| No Groq key                     | Voice notes fail with 503 "Voice notes need speech-to-text, which is not configured." Everything else works                                                                                                                    |
| Storage not configured          | 503 "File storage is not configured."                                                                                                                                                                                          |
| Provider timeout or all busy    | 503 "Flick took too long" or "Flick could not read this file. Try again later."                                                                                                                                                |

There is no non-AI fallback: without a model, nothing is extracted. Only the PDF text-layer step runs without a model's own PDF reading.

## Share target

- The installed PWA registers a share target (`apps/web/vite.config.ts`): method GET, action `/share`, fields `title`, `text`, `url`. Sharing text or a link from another app opens "Send to..." where you pick a chat. The text is sent as a normal text message.
- If AI is on, the page also shows "Ask Flick about this". It sends your question plus the shared text (up to 8,000 characters, inside `<shared>` tags marked as untrusted) to `POST /ai/chat` and streams the answer. The default question is "Summarise this and say what I should do about it."
- Gap: files are not accepted. The manifest has no file entries and no POST handler, so sharing a photo or PDF from another app to Flick does not work. Use the attach button in a chat.
- Status: Partial (text and links only).

## Privacy

- The file is read from storage by the server and sent to the model provider that answers (Anthropic, Gemini, or Groq for text and transcripts). Images are re-encoded before sending, so the sent copy has no EXIF data.
- No-AI mode on a chat blocks analysis of files sent in that chat.
- Voice notes sent to Groq Whisper for "Explain with Flick" are not saved as transcripts. Stored transcripts are a separate feature; see [translation and transcription](translation-and-transcription.md).
- The answer is shown to you only. It is posted to the chat only if you use "Reply with this" and send it yourself.

## Known gaps

- Video is not analysed.
- docx and xlsx are read as plain text (no images, formatting, formulas or comments).
- Old `.doc` and `.xls` are not supported.
- Only the first markdown table is parsed for CSV export.
- Receipt saving is text only.
- The share target does not take files.

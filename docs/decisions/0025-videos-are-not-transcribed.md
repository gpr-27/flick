# ADR-0025: Videos are not transcribed

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0017, ADR-0018, ADR-0016

## Context

Voice notes can be turned into text and searched. People asked for the same on videos. The speech-to-text service (Groq
Whisper) takes audio files, with a size limit of 25 MB per file (`MAX_AUDIO_BYTES`). A video file is much bigger than that
and mixes picture and sound.

## Decision

Only **audio files and voice notes** are transcribed. A message of type `video` is never sent to Whisper, by hand or by the
automatic job (`isTranscribable` returns false for videos). Transcribing a video would need the API to pull the sound out
first (for example with ffmpeg) and to cut it into pieces under 25 MB. That adds a heavy dependency and CPU work to a
free-tier service, so it is not built.

Related limits: AI analysis of a video is not built either. Image, PDF, text and audio files can be analysed (ADR-0017).

## Alternatives

- **Extract audio on the server with ffmpeg.** Works, but needs a binary, temporary files and time budgets the hosting
  plan does not give.
- **Extract audio in the browser.** Heavy on phones and unreliable for large videos.
- **Send the whole video to Whisper.** Fails above 25 MB, which is most videos.

## Trade-offs

Spoken words inside a video are not searchable. A person can still send the audio as a voice note or audio file.

## Consequences

- The transcript button and the auto-transcribe switch apply to voice notes and audio only.
- Docs: [`../ai/translation-and-transcription.md`](../ai/translation-and-transcription.md).

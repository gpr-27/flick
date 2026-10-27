# ADR-0017: Multimodal requests are routed to providers that can read them

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0014, ADR-0016

## Context

Flick can explain an image, read a PDF, answer questions about a text file or document, and transcribe a voice note. Not
every provider in the fallback chain can do that: the Groq chat models used here are text only, while Anthropic and
Gemini accept images and PDFs.

## Decision

- A request is a list of parts: text, image, document (PDF). `requiredCaps(request)` says whether it needs vision or
  PDF support. Each chain entry declares what it can do (`modelCaps`), and an entry that cannot read the request is
  **skipped**, not tried and failed. Text-only requests still use the whole chain.
- Files are prepared in the API before they reach `packages/ai`: images are decoded and shrunk (longest side 1,568 px,
  under 10 MB sent), PDFs up to 20 MB are sent as documents, text files up to 1 MB and DOCX and XLSX files are turned
  into text, and text is cut to 60,000 characters. The asker must be allowed to open the attachment (membership check).
- Voice notes are transcribed by Groq Whisper (`POST /ai/transcribe`, needs a Groq key), not by the chat models. The transcript
  is stored once (`message_transcripts`), shared by the chat and searchable.
- File contents are untrusted: they are fenced and the model is told not to obey them.
- If no available provider can read the file, the user gets a plain "can't read this file here" message. Nothing is faked.

## Alternatives

- **Send everything to every provider and let failures fall through.** Wastes time and quota on certain failures.
- **One multimodal provider only.** One outage would turn the feature off. The chain keeps text features alive.
- **OCR and PDF text extraction for everything.** Loses layout and images; models read them better directly.

## Trade-offs

Image and PDF requests have fewer providers to fall back on, so they fail more often than text. Preparing files costs API
memory (sharp, PDF and Office parsing), bounded by the byte limits above. Video is not analysed yet (see
[`../audit/missing-features.md`](../audit/missing-features.md)).

## Consequences

- Adding a provider means declaring its capabilities in one function.
- Docs: [`../ai/files-images-voice.md`](../ai/files-images-voice.md), [`../ai/architecture.md`](../ai/architecture.md).

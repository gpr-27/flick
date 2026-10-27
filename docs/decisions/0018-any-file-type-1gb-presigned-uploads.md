# ADR-0018: Any file type up to 1 GB, with safe serving

- **Status:** Accepted (2026-10-27). Replaces the allowlist part of ADR-0012.
- **Related:** ADR-0012, ADR-0019

## Context

People want to send any file: documents, archives, installers, large videos. A strict allowlist of types and a small size
limit blocked real use. But a chat that stores arbitrary files must not let one of them run as a web page (HTML, SVG and
script uploads are the classic attack), and large files must not pass through the API.

## Decision

- **Any type is accepted** for message attachments. The limit is `LIMITS.MAX_UPLOAD_BYTES` = **1 GB** per file (avatars:
  5 MB and image types only, decoded and re-encoded by sharp).
- **Bytes never touch the API.** The client asks `POST /media/presign`, gets a presigned POST form (10-minute expiry,
  size limit in the policy), uploads straight to S3, then calls `POST /media/:id/complete`. The server checks the stored
  size and, for types it can verify (JPEG, PNG, WebP, GIF, AVIF, MP4, WebM, PDF), sniffs the first 4 KB so a file cannot
  claim to be an image and be something else.
- **Safety comes from how files are served, not from an allowlist.**
  - Only `image/*` (except SVG and anything XML or HTML), `audio/*` and `video/*` may be shown **inline**.
  - A **PDF** is shown only through an explicit preview link (`GET /media/:id/url?preview=1`), because its type was
    verified against the bytes and a PDF viewer runs in its own sandbox.
    The preview rule is strict: the type must be `application/pdf` after the stored bytes were checked, and the
    `?preview=1` flag changes nothing for any other file (it still downloads). The link is `inline` and keeps the file
    name; the normal link is never inline for a PDF.
  - **Everything else** (HTML, SVG, scripts, archives, unknown types) is served as `application/octet-stream` with
    `Content-Disposition: attachment`, so the browser downloads it and never runs it.
  - Download links are signed GETs that expire in 5 minutes and are issued only after a membership check.
- **Object keys** are built from ids only (`messages/<user>/<attachment>`); the user's file name is sanitised and stored
  only as display text.
- **Abandoned uploads** (still `pending` after 24 hours) are removed by the worker (object first, then row).
- Albums send many files at once; the client limits itself to 3 uploads at the same time (ADR-0019).

## Alternatives

- **Allowlist by MIME type.** Easy to bypass (the declared type is a claim) and blocks legitimate files.
- **Proxy uploads through the API.** 1 GB files would exhaust API memory and bandwidth.
- **Virus scanning.** Not built; a scanner could be added on `complete` without changing the contract.

## Trade-offs

Flick stores files it cannot inspect, so recipients should treat downloaded executables like any download. A 1 GB cap is
a design default; the S3 bill and the free hosting plans set the real ceiling. Browser upload of 1 GB needs a stable
connection (uploads are not resumable yet).

## Consequences

- Storage use per chat is visible (`GET /media/usage`).
- Docs: [`../features/media-and-files.md`](../features/media-and-files.md), [`../security/auth.md`](../security/auth.md).

# Flick media: uploads, downloads, GIFs, link previews

Code: `apps/api/src/modules/media/` and `apps/api/src/modules/extras/`.

## Why bytes never pass through the API

A 100 MB video sent through the API would tie up a Node connection, memory and bandwidth for
the whole upload. So the API only hands out a signed permission slip. The browser uploads straight
to object storage (MinIO locally, a private AWS S3 bucket when deployed). The API stays small and fast.

## Upload flow

```
 Browser                      API                         Postgres      Object storage
    | POST /media/presign      |                              |               |
    |------------------------->| check type + size limit      |               |
    |                          | insert attachment (pending)->|               |
    |<-- url + signed fields --|                              |               |
    | POST file (multipart) ---------------------------------------------->   |
    |                          |                              |   S3 checks size + type
    | POST /media/:id/complete |                              |               |
    |------------------------->| HEAD: exists, same size? --------------->    |
    |                          | read bytes: sha256 + real type ------------>  |
    |                          | mark uploaded --------------->|               |
    |<-- attachment (ready) ---|                              |               |
```

1. **Presign.** The API checks the MIME type against an allow list and the size against the limit
   for the purpose (100 MB for messages, 5 MB for avatars). It stores a `pending` row and returns
   a presigned POST. The POST policy contains `content-length-range` and the exact `Content-Type`,
   so storage itself refuses a bigger or different file.
2. **Object key** is `messages/<user>/<attachment>` (or `avatars/`, `group-avatars/`). It is made
   from ids only, never from the file name. The file name is cleaned and kept only for display.
3. **Complete.** The declared type is only a claim, so the API reads the object once: it computes
   the sha256 and looks at the first bytes with `file-type`. This read is server to storage, not
   through the client. If the size or the real type does not match, the object is deleted and the
   request fails (400/415). Otherwise the row becomes `uploaded`. Calling complete twice is safe.
4. **Attach.** The messages module calls `assertAttachmentUsable(db, userId, id)` (owner's, uploaded,
   not yet used) and then `markAttached(tx, id)` inside the send transaction.

## Download

`GET /media/:id/url` returns a link that works for 5 minutes. It is given to the owner, to an active
member of a conversation that has a message with this file, and (for avatars only) to any signed-in
user. Everyone else gets 404, the same answer as for a missing file. Only images, audio and video are
shown inline; other files are forced to download.

## Avatars and voice notes

The deployed bucket is private, so the browser needs the bucket's CORS to list the web origin, and an uploaded
avatar is only shown by its public address when `S3_PUBLIC_URL` is set. Without it the app falls back to the Clerk
profile picture (`users.avatar_url`). Avatars use the same flow with purpose `avatar` or `group_avatar`. On complete, `sharp` makes 64 and
256 pixel square WebP copies (rotated by EXIF, metadata removed) and downloads serve the 256 copy.
Voice notes are plain audio uploads; the waveform and duration go inside the message content.

## Cleanup

`sweepAbandonedUploads(db, s3, olderThan)` deletes `pending` rows (and their objects) that were
never completed. The worker schedules it.

## GIFs and link previews

- `GET /gifs/search?q=` and `GET /gifs/trending` proxy GIPHY, so the key stays on the server. Results
  are cached in Redis for 5 minutes (the key allows about 100 calls an hour). A GIPHY 429 is passed on
  as 429. No `GIPHY_API_KEY` gives 503.
- `GET /link-preview?url=` mounts `@chat/link-preview` (SSRF guard, size and time limits, Redis
  cache). It needs login, allows 30 requests a minute per user, and the query string (the target URL)
  is not written to the request log.

## Without configuration

If `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing, `/media/*` returns 503 and the
message names the variable. Object storage is optional in the readiness check.

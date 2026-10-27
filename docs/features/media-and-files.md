# Media and files

Flick sends photos, videos, voice notes, round video notes, GIFs, stickers and files of any type. Files never pass through the API: the browser uploads them straight to object storage (MinIO locally, a private S3 bucket when deployed) with a short-lived signed form, and the API only checks the result. This page covers how to send and view media, the limits, the viewers and editors, and how uploads are checked. Code: `apps/web/src/features/{chat/upload.ts,content,gallery,photoeditor,docpreview}` and `apps/api/src/modules/media/`.

Related: [messaging.md](messaging.md) | [rich-messages.md](rich-messages.md) | [groups.md](groups.md) | [settings.md](settings.md) | [safety-and-privacy.md](safety-and-privacy.md) | [../ai/files-images-voice.md](../ai/files-images-voice.md) | [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md) | [../ai/README.md](../ai/README.md)

## Limits at a glance

| What                                   | Limit                                                            | Where it lives                                   |
| -------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Text message                           | 65,000 characters                                                | `LIMITS.MAX_TEXT_LENGTH`                         |
| Caption on a photo, video, file or GIF | 16,000 characters                                                | `LIMITS.MAX_CAPTION_LENGTH`                      |
| One file (any type)                    | 1 GB (`LIMITS.MAX_UPLOAD_BYTES`)                                 | web check, API check, and the signed form itself |
| Avatar (profile or group photo)        | 5 MB, and only jpeg, png, webp or avif                           | `LIMITS.MAX_AVATAR_BYTES`                        |
| Voice note                             | up to 60 minutes of audio, 1 to 128 waveform bars                | `VoiceContent` schema                            |
| Round video note                       | 60 seconds                                                       | `MAX_VIDEO_MS` in `content/camera/capture.ts`    |
| GIF made from a video                  | up to 5 seconds, 10 frames per second, 240 px wide               | `GifMakerDialog.tsx`                             |
| Album (multi-select send)              | 20 items, 2 GiB total, 3 uploads at a time, each file up to 1 GB | `LIMITS.MAX_ALBUM_*`, see "Albums" below         |
| Download link                          | valid for 5 minutes                                              | `DOWNLOAD_URL_SECONDS`                           |
| Upload form                            | valid for 10 minutes                                             | `UPLOAD_URL_SECONDS`                             |

## Sending a photo, video or file

**What it does.** Pick, take, paste or drop a file. It starts uploading at once, in the background, so pressing Send is instant when the upload is done (or the message goes out the moment the upload finishes).

**How to use it.**

- Photo or video button: opens the picker for images and videos. You can pick several at once. One photo opens the editor first (see below); two or more go to the media tray (see "Albums").
- Paperclip button: any file. The picker accepts everything (`*/*`) and also allows several files.
- Camera button: take a photo or record a video in the app (`CameraCapture`). The photo or video then behaves like any picked file, but skips the editor.
- Paste: a screenshot or copied picture in the message box is attached (`imageFromClipboard`). It skips the editor. Pasting several pictures or videos at once opens the media tray.
- Drag and drop: drag files over the chat. The whole chat area shows a "Drop to send" overlay (`DropOverlay`). One dropped file is attached as before; several, or any file dropped while the tray is open, go to the media tray.
- Add a caption in the message box, then Send. While a picture or video is attached you can tick "view once" (see [rich-messages.md](rich-messages.md)).

**How the app decides the message type** (`attachmentKindFor`):

| File                                                                                | Sent as                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| jpeg, png, webp, gif, avif, bmp                                                     | photo (`image` message)                        |
| mp4, webm, mov (quicktime), ogv, m4v                                                | video (`video` message)                        |
| Everything else: documents, archives, HEIC, TIFF, SVG, RAW, MKV, AVI, unknown types | file (`file` message with icon, name and size) |

If the browser gives no type, the app guesses it from the file extension (a list of about 60 extensions in `upload.ts`), and falls back to `application/octet-stream`.

**Photos are shrunk before upload.** Unless it is a GIF or already 300 KB or smaller, a photo is scaled to at most 1600 pixels on its longest side and saved as a JPEG at quality 0.82 (`lib/imageCompress.ts`). Phone photos of 4 to 8 MB become a few hundred KB. To keep the original, use "Send as file" in the photo editor. Videos and files are uploaded as they are.

**Upload progress, cancel and retry.**

- A progress ring and "Uploading 42%" show while it uploads. If you press Send early, the text changes to "Sending when ready".
- The small X on the attachment ("Remove attachment") cancels: the app forgets the upload and ignores its answer. It does not abort the network request already running; the partly uploaded object is cleaned up later by the worker (see "Cleanup").
- If it fails, the red message says why and shows Retry (not shown if the file is over the limit).
- Each upload has a time allowance that grows with size: at least 2 minutes, and more for big files (it assumes a speed of at least 256 KiB per second). A stuck upload ends with "The upload took too long" and Retry.
- After sending, a message that could not be delivered shows its own "Retry" and "Discard" under the bubble.

**Too large.** Before anything is read or uploaded, the app checks the size. Over 1 GB gives: "This file is 1.4 GB, but the limit is 1 GB per file. Bigger uploads often fail halfway on slow connections, so they are not accepted. Send a smaller file, compress it, or share a link instead." (sizes written with `formatBytes`). The API repeats the check with a similar message (HTTP 413), in case a client skips it.

**Status: Built.**
Gap: the single-file flow above is for one file at a time; several photos and videos use the album flow below. "Send as files" is not grouped (see "Albums").

AI: after a photo, PDF, file or voice note is in a chat, its message menu has "Explain with Flick" (when AI is on). See [../ai/files-images-voice.md](../ai/files-images-voice.md).

## How an upload is checked (API)

```
Browser                      API                          Object storage
  | POST /media/presign       |  type + size allowed?        |
  |-------------------------->|  insert pending row          |
  |<-- url + signed fields ---|                              |
  | POST file (multipart) --------------------------------->|  storage enforces size and type
  | POST /media/:id/complete  |                              |
  |-------------------------->|  HEAD: same size?  -------->|
  |                           |  read bytes: sha256 + type ->|
  |<-- attachment (ready) ----|                              |
```

1. **Presign** (`POST /media/presign`, 60 per minute per user). Message attachments accept any MIME type. The size is checked against the limit for the purpose (1 GB for messages, 5 MB for avatars). The signed POST contains `content-length-range` and the exact `Content-Type`, so storage itself rejects a bigger or different file.
2. **Object key** is built from ids only (`messages/<user>/<attachment>`), never from the file name. The file name is cleaned and kept only for display.
3. **Complete** (`POST /media/:id/complete`). The API compares the stored size with the declared size, reads the object once to compute a sha256, and sniffs the real type from the first bytes. Only these declared types are verified against the bytes: jpeg, png, webp, gif, avif, mp4, webm and PDF. If one of them is declared, the bytes must really be that container (an m4a voice note detected as mp4 is accepted as the same container). A declared `text/plain` must be valid UTF-8 without NUL bytes. Every other type (zip, docx, mov, unknown) is accepted as declared, because it is only ever served as a download or as plain media. A mismatch deletes the object and returns 400 or 415. Calling complete twice is safe.
4. **Attach.** Sending the message marks the attachment as used inside the same transaction. An attachment can be used once, and only by its owner.

**Status: Built.**
Gap: types such as mov or docx are not verified, only trusted as declared (they cannot run in the browser because of how downloads are served, see below).

## How files are shown and downloaded

`GET /media/:id/url` returns a link that works for 5 minutes. It is given to the owner, to an active member of a conversation that has a message with the file, and (for avatars only) to any signed-in user. Everyone else gets 404, the same answer as for a missing file.

| Type                                           | What the link does                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Images (except SVG), audio, video              | served inline, so they play or show in the chat                                                                                         |
| PDF                                            | a download by default; only with `?preview=1` it is served inline, as `application/pdf`, for the preview window                         |
| HTML, SVG, XML, JavaScript, everything unknown | always a download (`Content-Disposition: attachment`, served as `application/octet-stream`) so an uploaded file can never run as a page |

The "media auto-download" setting (Settings, see [settings.md](settings.md)) decides if photos, videos and voice notes load by themselves (always, Wi-Fi only, never). When they are held back, the bubble shows a "tap to download" box. A photo or video that fails to load shows an "unavailable" icon with a Reload button, which asks for a fresh link.

**Status: Built.**

## File messages and preview

A file message shows an icon, the name and the size. Tapping it fetches a fresh signed link and opens it in a new tab, which downloads the file. If that fails, a line says "Couldn't get this file. Tap the file to try again with a fresh link."

A small "Preview" link appears under files whose name ends in `.pdf` (PDF preview) or `.txt .md .csv .json .log .xml .yml .yaml` (text preview). It opens a window (`DocPreview`):

- PDF: shown in the window through the preview link (`?preview=1`). The window has an "Open in new tab" button.
- Text: only the first 4,096 bytes are fetched (a range request) and the first part (about 2 KB, cut at a line end) is shown, followed by "...".
- Escape or the close button closes it. If the preview fails, the window says to close it and tap the file to download.

**Status: Built.**
Gap: no preview for Word, Excel, PowerPoint, images inside zip files, or other types; they download. The text preview is only the beginning of the file, not the whole file.

AI: PDFs and files can be summarised or asked about with "Explain with Flick". See [../ai/files-images-voice.md](../ai/files-images-voice.md).

## Gallery viewer

**What it does.** Tapping a photo or video opens a full-screen viewer over every photo and video of the chat, oldest first (`galleryItems`, `MediaLightbox`). It opens at the item you tapped; for an album it opens at the tile you tapped.

**How to use it.**

- Top bar: Back (arrow) and Close (X) both close it, "3 of 12" counter, Forward (forwards this message, shown when forwarding is allowed), Download.
- Previous and next buttons at the sides, the left and right arrow keys, or a swipe sideways. A swipe down closes it.
- The mouse wheel (or trackpad pinch) zooms from 1x to 5x. While zoomed in, swiping does not change the item.
- Escape, a tap on the dark area (not on the photo), the Back button of the phone or browser, and the Back arrow all close it. The caption, if any, shows at the bottom.

**How it is built.** The viewer is drawn in a portal on `document.body` at z-index 1000, above every other layer. While it is open the rest of the page is `inert` and hidden from screen readers, page scroll is locked, focus is trapped inside it and returns to the tile when it closes. The phone Back button closes it through the shared back stack (see [message-gestures.md](message-gestures.md)).

The "Media" tab in the chat info lists the same media (the Shared tab also has Links, Docs and Voice, see [search-and-organise.md](search-and-organise.md)).

**Status: Built.**
Gap: the viewer pages through the messages that are loaded in the chat, not the whole history. There is no two-finger pinch handler of its own; pinch works only where the device sends it as a wheel event.

## Photo editor

**What it does.** When you pick a JPEG, PNG or WebP photo with the photo/video button, an editor opens before it is attached (`PhotoEditor`). GIFs and other formats skip it, and so do camera, pasted and dropped photos.

**How to use it.**

- Rotate 90 degrees (repeat to turn more).
- Crop: Free (whole picture), 1:1 or 4:3. The crop is the largest centred rectangle of that shape.
- Caption field. The caption is put in the message box.
- "Send as file (original quality)": skips compression and sends the picture as a file message.
- Send. The edited picture is re-drawn on a canvas (JPEG at 0.92, or PNG if the source was PNG). If nothing was changed, the original file is used.

**Status: Built.**
Gap: no drawing, text, stickers or filters; free-form crop (dragging the corners) is not available, only the three fixed shapes, always centred.

## Voice notes

**What it does.** Record a voice message and send it with a waveform.

**How to use it.**

- Tap the microphone button. A bar covers the message box with the timer, Cancel (X), Trim and Send.
- Trim: opens a review with two sliders for start and end, then "Send trimmed voice message" (or discard).
- Optional view-once tick before sending.
- Recording uses the browser's own noise suppression, echo cancellation and automatic gain control. It records as MP4 audio when the browser can (so phones can play it), and as a WAV file when it cannot, instead of WebM.
- Playing: play/pause, a waveform that fills as it plays, the time, and a speed button that cycles 1x, 1.5x and 2x. "Auto-next" (on by default, remembered on this device) plays the next unplayed voice note below when one ends.
- Voicemail: after a missed outgoing 1:1 call, the Calls page offers a microphone that sends a voice note flagged "Voicemail" (see [calls.md](calls.md)).

The upload is part of Send: the note is uploaded when you press Send and, if it fails, a retry is offered.

**Status: Built.**
Gap: noise suppression is the browser's, not a Flick filter. There is no lock-and-hold gesture; recording is tap to start and tap Send to stop.

AI: a transcript is shown under the voice note (and can be translated, copied, shared or edited). See [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md).

## Round video notes

**What it does.** Records up to 60 seconds from the front camera and sends it as a video drawn in a circle (`VideoContent.round`).

**How to use it.** In the message box open the tools button (map pin icon), "Record a video note". The dialog asks for camera and microphone (480 x 480), shows the timer against 60 s, and uploads when you stop. In the chat it plays in a 224 px circle.

**Status: Built.**
Gap: front camera only; no re-record preview before sending beyond the dialog itself.

## Sticker maker

**What it does.** Turns a photo into a rounded-corner sticker and sends it as an image marked `sticker` (384 x 384 PNG, drawn small and without a frame).

**How to use it.** Tools button, "Make a sticker", pick a photo (the centre square is used). Send it or keep it in "My stickers", which are stored in this browser (IndexedDB) and are not synced between devices. GIPHY GIFs and stickers are chosen from the "GIFs and stickers" button (a separate message type that points at a GIPHY URL, searched through the API's GIPHY proxy; results are cached 5 minutes, and without a `GIPHY_API_KEY` the API answers 503).

**Status: Built.**
Gap: "My stickers" live on one device only.

## GIF maker

**What it does.** Makes a looping GIF from a video file.

**How to use it.** Tools button, "Make a GIF from a video". Pick a video, move the start slider, choose a length up to 5 seconds. The app draws 10 frames per second on a canvas, 240 px wide, and encodes a GIF in the browser with a built-in encoder (216-colour palette). The result is uploaded and sent as a photo message.

**Status: Built.**
Gap: small and low colour depth by design; not meant for long or high quality GIFs.

## Albums (multi-photo send)

**What it does.** Send up to 20 photos and videos at once. In the chat they appear as one grid with a single caption.

**How to use it.**

1. Pick several files with the photo/video button, paste several pictures, or drop several files on the chat. Two or more files open the media tray above the box (`features/chat/album/AlbumTray`); one file keeps the normal single-file flow with the editor.
2. The tray shows a small tile for each file with its progress, a Retry button for a failed one, a Remove button per tile and "Add more". The header shows "N/20", a "Send as files (original quality)" switch and a button that cancels everything (it asks first if uploads are still running).
3. Type one caption in "Add a caption..." and press Send. Uploads start as soon as files are added and run 3 at a time; Send goes out for the items that are ready and the rest follow when their upload ends.

**Limits.** 20 items, 2 GiB in total for one send, 3 uploads at the same time, each file up to 1 GB (`LIMITS.MAX_ALBUM_ITEMS`, `MAX_ALBUM_BYTES`, `MAX_ALBUM_CONCURRENT_UPLOADS`, `MAX_UPLOAD_BYTES`). A pick that is too big is trimmed: the first files that fit are kept and a notice gives the numbers and the reason ("You can send up to 20 photos and videos at once (you picked 24) so uploads stay reliable. The first 20 were kept." or "These files add up to ... the limit for one send is 2 GB ..."). A file over 1 GB is refused on its own.

**How it is stored.** An album is not one big message (ADR-0019). Each item is its own ordinary `image` or `video` message with its own attachment, receipts, reactions, star and delete. Every item carries `album: { id, index, count, videos? }`; `id` is shared, `index` is the position from 0, `count` the number of items and `videos` how many are videos. The server rejects an `index` that is not below `count`, or `videos` above `count`. The caption and the reply target go on the first item only.

**How it looks.**

- Chat: consecutive messages from one sender with the same album id are drawn as one grid (`AlbumGrid`): 1 tile alone, 2 side by side, 3 as one large tile over two, 4 as 2 by 2. With 5 or more, four tiles show and the last says "+N" for the rest. The caption shows under the grid. Tapping a tile opens the gallery viewer at that photo; a long press or right click on a tile runs the message menu for that one item.
- Chat list: "4 photos", "3 photos and 2 videos" (`albumLabel`) instead of the last item, with the caption after a colon when there is one.
- Notifications: one alert per album, sent for its first item ("4 photos"); the other items are silent but still count as unread.
- Older clients that do not know the field show the items one by one.

**Leaving while uploading.** Uploads belong to the composer. Switching to another chat while uploads are running asks "N uploads are still in progress. Leave and cancel them?"; closing the tab shows the browser warning. If you agree, the unsent uploads are dropped.

**Status: Built.**
Gaps:

- "Send as files (original quality)" is not grouped: every item goes as a separate `file` message (the album field exists only on photo and video messages), in picked order, with the caption on the first.
- Files that are not photos or videos in the same pick are sent after the album as separate file messages.
- If one item fails, the others still arrive; the failed one needs Retry or Remove. Forward, delete and star work per item, not on the whole album.
- If another message lands between two items, the grid splits (rare, items are sent back to back).

## Avatars

Profile and group photos use the same flow with purpose `avatar` or `group_avatar`. Only jpeg, png, webp and avif are accepted (HEIC is not: the image library has no decoder for it), at most 5 MB. When the upload completes, the server decodes and re-encodes the image into 64 px and 256 px square WebP copies (rotated by EXIF, metadata removed). Downloads serve the 256 px copy. The deployed bucket is private, so it needs CORS for the web origin, and an uploaded avatar is shown by its public address only when `S3_PUBLIC_URL` is set; otherwise the app falls back to the sign-in profile picture. See [profile.md](profile.md).

**Status: Built.**

## Link previews

A link in a text message shows a preview card (`GET /link-preview?url=`, login needed, 30 requests a minute per user; the server guards against requests to private addresses and limits size and time). The sender can switch the preview off for one message (`no_preview`), and a settings switch turns previews off for the reader. See [settings.md](settings.md).

**Status: Built.**

## Cleanup and configuration

- `sweepAbandonedUploads` deletes upload rows still `pending` (and their objects) that were never completed. The worker schedules it.
- If `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is missing, `/media/*` answers 503 and names the missing variable. Object storage is optional in the readiness check.

## Tests

Unit tests live next to the code (`upload.test.ts`, `gallery.test.ts`, `editPhoto.test.ts`, `previewKind.test.ts`, `content.test.tsx`, `mediaReload.test.tsx`, voice tests). API behaviour is covered by the media integration tests.

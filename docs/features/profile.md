# Profile

Your profile is your display name, a unique username, an About line and a photo. You edit it on the
Profile page (`/profile`) and share it with a link or a QR code. Your profile belongs to Flick: the name,
username and photo you set here are kept only in Flick and are never written back to your sign-in
account (Clerk). Clerk's name and photo are used once, when your Flick account is created. There is one
optional AI button, "Write my bio". Status: Built.

## Related

- [Settings](settings.md): the Account section links here; [Safety and privacy](safety-and-privacy.md)
  controls who sees your photo and About
- [Notifications](notifications.md), [Guide](guide.md) (the Profile tip)
- [Security: sign-in](../security/auth.md)
- [AI: writing assistant](../ai/writing-assistant.md) (Write my bio)
- Code: `apps/web/src/features/profile/`, `apps/api/src/modules/users/`,
  `apps/api/src/modules/auth/authenticate.ts`

## Where your name and photo come from

| Moment                           | What happens                                                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First sign-in (account creation) | The API reads your Clerk profile once. Display name = Clerk first and last name (or the username); username = a clean version of your Clerk username or email name (3 to 32 characters, with a random suffix if it is taken); photo = your Clerk picture address |
| After that                       | Flick is the only source of truth. Changing your name, username, About or photo in Flick **does not touch Clerk**, and changing them at Clerk does **not** change Flick                                                                                          |
| **Use my sign-in photo**         | A menu choice on the Profile photo button. It copies your current Clerk photo into Flick as a normal photo upload when you press Save. It is shown only if your sign-in account has a photo                                                                      |

There is no two-way sync. An older design synced names between Flick and Clerk; that code is gone.

## What you can edit

| Field        | Rules                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display name | 1 to 64 characters                                                                                                                                                                                 |
| Username     | 3 to 32 characters: letters, numbers, `_` and `.`. Unique. The page checks availability as you type                                                                                                |
| About        | Up to **139** characters, shown with a live counter. Basic Markdown is rendered. Quick statuses fill it in one tap: Available, Busy, At school, At work, In a meeting, Sleeping, Only urgent calls |
| Photo        | See below                                                                                                                                                                                          |

Press Save. The page warns before you leave with unsaved changes. When you save, everyone you chat
with sees the new name, username and photo live (a `user_updated` event; changing only About sends
nothing). Privacy settings can hide your photo and About from others.

AI, optional: **Write my bio** next to the status chips asks Flick to turn what is in About (or your
name as a hint) into a short bio that fits 139 characters. It only runs when you tap it and only if AI
is set up. You can edit the result before saving.

## Photo

The camera button on your avatar opens a menu:

| Choice               | What it does                 |
| -------------------- | ---------------------------- |
| Choose a photo       | Pick a file from your device |
| Use my sign-in photo | See above                    |
| Take a photo         | Opens the camera             |
| Remove photo         | Clears your photo            |

Every photo goes through a **cropper**: drag to position and zoom up to 3 times, in a square. The result
is saved as a 512 by 512 JPEG, so the server only ever receives a JPEG. The maximum upload size is
5 MiB. Pictures are decoded in your browser with the correct rotation (EXIF) and shrunk to at most 2048
pixels on the long side first.

**Formats:** JPEG, PNG, WebP, GIF, BMP and AVIF where the browser can read them. **HEIC/HEIF** photos
work only where the browser can decode them (Safari does; most other browsers do not). When it cannot,
you see: "This browser can't open HEIC photos. Save or export the photo as JPEG or PNG, or take a new
one, and try again." Flick does not convert HEIC itself.

## Share your profile

| Button         | What it does                                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| Share profile  | Opens the phone's share sheet; if there is none, copies the link                    |
| Copy @username | Copies `@username`                                                                  |
| QR code        | Shows a QR code of your link with a **Download** button (`flick-<username>-qr.png`) |

The link is `https://<app>/u/<username>`. Opening it shows the **public profile page**: photo, name,
About and a **Message** button that opens or starts a direct chat. It follows your privacy settings.

## Stats and completeness

- **Your stats:** number of chats, groups and days on Flick (`GET /users/me/stats`).
- **Profile completeness:** 0, 33, 67 or 100 percent, from three things: a photo, an About line and a
  name that is not just your username. A one-line hint says the next step.

## Limits and gaps

| Item                              | Status                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| Edit name, username, About, photo | Built                                                        |
| Crop, QR, share, public page      | Built                                                        |
| Use my sign-in photo              | Built (one-way copy on request)                              |
| HEIC photos                       | Partial: only where the browser can decode them              |
| Sync with Clerk after sign-up     | Not built, on purpose                                        |
| Change your email or password     | Not in Flick's own screens (handled by the sign-in provider) |

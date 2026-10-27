# Flick: login, identity and security controls

Login is **Clerk**; Flick has no passwords, no refresh tokens and no credential storage of its own. This page explains
how a request is authenticated, how the first sign-in creates a Flick user, how devices work, how the sign-in screens
are wired, and the other security controls (webhook and email secrets, upload safety, the safe link fetcher, how AI
text is fenced, and the privacy controls). The short threat list is in [`threat-model.md`](threat-model.md).

Related: [`threat-model.md`](threat-model.md), [`../decisions/0010-clerk-login.md`](../decisions/0010-clerk-login.md),
[`../decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md`](../decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md),
[`../decisions/0018-any-file-type-1gb-presigned-uploads.md`](../decisions/0018-any-file-type-1gb-presigned-uploads.md),
[`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md), [`../features/safety-and-privacy.md`](../features/safety-and-privacy.md),
[`../operations/deployment.md`](../operations/deployment.md).

## Why Clerk and not custom auth

- Passwords, email codes, social login, bot checks and password resets are easy to get subtly
  wrong and carry real risk. Clerk does them as its whole job.
- Our API only needs one answer: "which user is this request from?" That is a small, checkable
  piece of code.
- Less code to write, secure and defend.

## How a request is checked

```
Browser (Clerk signs the user in, gives a short-lived session token)
   |  Authorization: Bearer <Clerk token>
   |  X-Device-Id: <uuid the browser made once>
   v
API  authenticate():
   1. verify the token with @clerk/backend (signature, expiry, issued to our web origin)
   2. Clerk id (token "sub")  ->  local `users` row, created on first sight
   3. upsert the `devices` row for X-Device-Id
   4. req.auth = { userId, deviceId }
```

- **Verification** uses `CLERK_SECRET_KEY`. Clerk tokens expire in about a minute; the web client
  asks Clerk for a fresh one for each request, so there is nothing for us to refresh.
- **Local user.** Messages and groups point at our own `users.id`, not at Clerk ids. The first
  time a Clerk id appears we make one Clerk API call for name, email and picture and create the
  row (see "First sign-in" below). After that the profile is ours: the user edits it with `PATCH /users/me`.
- **Username.** The Clerk username (or the start of the email) is used; if taken, a short random
  suffix is added. Display names do not have to be unique.
- **Cache.** A successful check is remembered in Redis for 5 minutes per (user, device), so most
  requests skip the database. If Redis is down we simply do the check every time. The price: a
  user who is disabled keeps working for up to 5 minutes.
- **Socket.IO** uses the same code: the handshake sends `auth: { token, deviceId }`, and the
  gateway calls `authenticateSocket(token, deviceId)`, which returns the same
  `{ userId, deviceId }` or `null`. The token is only checked at connect time; the browser
  reconnects with a fresh token if the connection drops.

## What a device is

A device is one browser (or app install). The client makes a UUID once, keeps it in local storage
and sends it as `X-Device-Id`. We need it because delivery is tracked **per device**: a user's
laptop and phone each catch up on the messages they missed, and presence is per device. A device
id already owned by another user is refused (403), so one person cannot read another's sync state.

**Signing a device out.** Settings > Account lists a user's devices (`GET /devices`) and can sign
one out (`DELETE /devices/:id`) or all but the current one (`POST /devices/revoke-others`). That sets
`devices.revoked_at`, deletes the remembered check in Redis (otherwise it would work for up to 5
minutes) and closes the device's sockets on every API replica. From then on that device id gets
401, and using it again does not bring it back. A user can only see and revoke their own devices:
another user's device id answers 404. The device name ("Chrome on macOS") comes from the
User-Agent the first time the device is seen.

**Deleting an account.** `POST /users/me/delete` with the exact username sets `status = 'deleted'`,
replaces the display name with "Deleted user", clears About, photo and email, frees the username,
removes push subscriptions and revokes every device. The row and the Clerk id stay, so the old
messages keep a sender and a later sign-in with the same Clerk account is refused (403) instead of
creating a new account.

## Sign-in screens (web)

`apps/web/src/main.tsx` mounts `ClerkProvider` with the app's own routes, so sign-in never leaves Flick:

| Setting                | Value      | Why                                                                                     |
| ---------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `signInUrl`            | `/sign-in` | Without it Clerk falls back to its hosted Account Portal and asks for a second account. |
| `signUpUrl`            | `/sign-up` | Same.                                                                                   |
| fallback redirect URLs | `/`        | Where to go when there is no `redirect_url`.                                            |
| `afterSignOutUrl`      | `/`        | Back to the signed-out page.                                                            |

The same paths are set in the Clerk dashboard (Paths): sign-in page `/sign-in`, sign-up page `/sign-up`, home URL `/`
and the page after sign-out `/`. The code and the dashboard must agree, or Clerk sends people to its hosted pages.

After Clerk finishes on `/sign-in` or `/sign-up`, the `AfterSignIn` route sends the person to `redirect_url`, but only
when it is a path on this site (`safeReturnTo`); another origin, `//host` or a script URL falls back to `/`. Signing out
forgets the browser's device id so the next sign-in registers a new device.

## First sign-in: how a Flick user is provisioned

1. The first request with a valid Clerk token carries a Clerk id (`sub`) that has no `users` row.
2. The API makes one Clerk call for name, email and picture, then inserts the `users` row (with `user_settings`). Two first requests can race: the loser
   reads the winner's row.
3. The username is the Clerk username, or the start of the email; a short random suffix is added if it is taken.
   Username is **optional** in Clerk.
4. A device row is created for `X-Device-Id`. If the person already had another active device, a **new-device alert**
   is posted by the Flick bot in their Saved messages (see below).

Nothing is copied back to Clerk except when the person edits their profile in Flick (the profile is Flick's, see
ADR-0020).

## Origins: `CORS_ORIGINS` and `authorizedParties`

`CORS_ORIGINS` (comma-separated, no trailing slash, no path) is used twice by the API:

- as the **CORS allow-list** for REST and Socket.IO, and
- as Clerk's **`authorizedParties`**: a session token is accepted only if it was issued to one of these web origins.

If it does not match the page address exactly (`https`, no preview URL), the browser shows a CORS error and every call
after sign-in answers 401. This is the first thing to check ([`../operations/runbook.md`](../operations/runbook.md)).

## Passkeys and other sign-in methods

Passkeys are a Clerk feature and are enabled in the Clerk dashboard for this app (User and authentication, Passkeys). If
they are ever turned off there, the Passkeys card in Settings, Account stays hidden. A username is optional in Clerk
(Flick falls back to the start of the email). Flick adds no code to the passkey ceremony itself; it lists and removes
the person's passkeys through Clerk's client SDK.

## New-device sign-in alerts

When a device is seen for the first time and the person already has another active device, the API posts a message from
the Flick bot into their Saved messages ("New sign-in: your account was signed in from Chrome on macOS...") which also
produces a notification. It is skipped for the very first device and when the person turned **Alert me about new
sign-ins** off (`user_settings.login_alerts`, `GET`/`PUT /users/me/login-alerts`). It is best effort: a failure never
blocks sign-in. The person can sign out other devices in Settings, Devices.

## Webhook and email secrets

- **Incoming webhooks** (`POST /hooks/:id/:token`): the token is random, shown **once** when the webhook is created, and
  only its hash is stored (`chat_webhooks.token_hash`). The check is a constant-time comparison and a wrong id and a
  wrong token give the same 404. 30 requests per minute per IP. Posts appear as the Flick bot with the webhook's name.
  Any member of the chat can list and revoke the chat's webhooks.
- **Invite and call links** also store only a SHA-256 of the token.
- **Email address in Settings.** `GET /platform/email-alias` returns `<username>@INBOUND_EMAIL_DOMAIN` only when both the
  secret and the domain are set; otherwise `null` and nothing is shown.
- **Inbound email** (`POST /inbound/email`): answers 404 unless `INBOUND_EMAIL_SECRET` is set. The provider must send the
  secret in the `x-inbound-secret` header (constant-time comparison; 401 otherwise). An unknown recipient still returns
  200 so the provider does not retry forever. Mail lands only in the matching user's Saved messages, cut to 60,000
  characters. 120 requests per minute per IP.

## Upload safety

Details are in ADR-0018. In short: any file type is accepted up to 1 GB, bytes go straight to S3 with a presigned POST
that has an expiry and a size limit, the server verifies size and (for known types) the real type, object keys contain
ids only, and downloads are signed links that expire in 5 minutes and need a membership check. **Only images (not SVG),
audio and video are served inline; a PDF only through an explicit `?preview=1` link and only when the stored bytes were
verified as a PDF; everything else is forced to download as
`application/octet-stream`**, so an uploaded file can never run as a page. Avatars are decoded and re-encoded.

## Browser permissions header

The web app is served with `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)` (in
`apps/web/vercel.json`), so only Flick's own pages can ask for the camera and microphone (calls, video notes, voice
notes) and for location (sharing a location). Other headers set there: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`.

## Safe link fetching (SSRF)

Two places fetch URLs on the server: link previews (`packages/link-preview`) and the page reader used by the AI link
check. Both are treated as an SSRF surface:

- only `http` and `https`;
- the host is resolved and **every answer is checked at connect time**, so private, loopback, link-local and metadata
  addresses are refused even through DNS tricks and redirects (the socket uses a pinned lookup);
- limited redirects (3), a short timeout (5 s), a response size cap (1 MB), text only;
- results are cached by a hash of the normalised URL and requests for the same URL share one fetch;
- the result is sanitised and returned as plain data; recipients never fetch the URL for a preview.

## AI text is untrusted

Everything that goes to a model from a chat, a file, a web page or a transcript is **untrusted data**:

- it is placed inside fenced tags (for example `<messages>...</messages>`) and the system prompt says never to follow
  instructions found there and never to reveal the prompt;
- model output is rendered with the safe Markdown renderer (no raw HTML, safe links only);
- a model returns text; any follow-up action (send, create a reminder, post a poll) happens only when the person clicks it;
- prompts and answers are not logged;
- AI is off for a chat when the person switched it off. The switch is checked on every path that reads the chat: the AI
  routes, writing-style samples, Whisper transcription, translate and translate-batch, the @flick bot and the background
  jobs (auto-translate, auto-transcribe). Every call is rate limited and counted against a daily quota.

See [`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md) and ADR-0016.

## Privacy controls a person has

| Control                                    | Where              | Effect                                                                                                       |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Last seen, photo, about audience           | Settings, Privacy  | `everyone` or `nobody`; server hides the value from everyone else                                            |
| Read receipts                              | Settings, Privacy  | Off means you do not send read receipts                                                                      |
| Block and report                           | Profile, chat menu | Blocked people cannot message or call you and get no profile updates                                         |
| Allow Flick to read this chat              | Chat info          | Off blocks all AI use of that chat's text, including style samples, Whisper, translation and background jobs |
| AI data export and erase                   | Settings, AI       | `GET`/`DELETE /ai/data`, clear Flick memories, clear the Flick chat                                          |
| Disappearing messages and view once        | Composer           | Expire or hide content after it is seen                                                                      |
| Chat lock and hidden chats                 | Chat menu          | A convenience lock in the browser, **not** server-side security (ADR note in the web README)                 |
| Delete chat / delete account / export data | Settings           | Per-person delete, account delete with tombstones, JSON export                                               |
| Devices                                    | Settings, Devices  | See and sign out devices                                                                                     |
| New-sign-in alert                          | Settings, Security | See above                                                                                                    |

Messages are not end-to-end encrypted ([ADR-0011](../decisions/0011-e2e-encryption-deferred.md)); the server can read
them. That is stated in the app and the docs.

## Errors

| Case                                | Answer |
| ----------------------------------- | ------ |
| No token, bad token, expired token  | 401    |
| `X-Device-Id` missing or not a UUID | 400    |
| Device id belongs to another user   | 403    |
| Device was signed out (revoked)     | 401    |
| Local user is disabled or deleted   | 403    |

A missing `CLERK_SECRET_KEY` stops the API at startup with a message naming the variable.

## Demo accounts

There is no open sign-up for the demo and no custom demo endpoint.

- **Seeded demo users** (`alice`, `bob`, ...) are plain local users with no Clerk account. They
  make the data look real but nobody can log in as them.
- **A demo login:** in the Clerk dashboard create a user (Users > Create user), give it a
  username, email and password, and turn off "Sign-ups" under User & authentication if you want
  to keep the app closed. Share those credentials only with the people you choose. The first
  request creates the matching local user.

## Rate limits

One global per-IP limiter (Redis backed) covers every route. There is no per-account login
limiter any more: Clerk protects its own sign-in.

## Env vars

| Name                         | Where | Meaning                                                                                  |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`           | api   | Verifies tokens, reads Clerk profiles                                                    |
| `VITE_CLERK_PUBLISHABLE_KEY` | web   | Lets the browser talk to Clerk                                                           |
| `CORS_ORIGINS`               | api   | CORS allow-list and Clerk `authorizedParties`                                            |
| `INBOUND_EMAIL_SECRET`       | api   | Secret the email provider sends; unset turns email-to-chat off                           |
| `INBOUND_EMAIL_DOMAIN`       | api   | Domain of the forwarding address shown in Settings (display only; does not grant access) |
| `E2E_FAKE_AUTH`              | api   | Test-only login; the API refuses to start with it in production                          |

## What to say in an interview

- "I did not build auth. Clerk owns credentials; my API only verifies a signed token and maps the
  Clerk id to my own user row, so my data never depends on Clerk's ids."
- "Tokens are short-lived, so I never store sessions or refresh tokens. Revoking a user in Clerk
  cuts them off within a minute, plus my 5-minute cache."
- "The device id is client-generated and checked against the user, because delivery state is per
  device."
- Trade-off: we depend on Clerk being up for sign-in (not for already-valid tokens: verification
  uses cached public keys).

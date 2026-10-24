# Flick: login and identity

Login is **Clerk**. Flick has no passwords, no refresh tokens and no sign-up code of its own.

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
  row. After that the profile is ours: the user edits it with `PATCH /users/me`.
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

| Name                         | Where | Meaning                               |
| ---------------------------- | ----- | ------------------------------------- |
| `CLERK_SECRET_KEY`           | api   | Verifies tokens, reads Clerk profiles |
| `VITE_CLERK_PUBLISHABLE_KEY` | web   | Lets the browser talk to Clerk        |

The allowed web origins (`CORS_ORIGINS`) double as the token's authorized parties.

## What to say in an interview

- "I did not build auth. Clerk owns credentials; my API only verifies a signed token and maps the
  Clerk id to my own user row, so my data never depends on Clerk's ids."
- "Tokens are short-lived, so I never store sessions or refresh tokens. Revoking a user in Clerk
  cuts them off within a minute, plus my 5-minute cache."
- "The device id is client-generated and checked against the user, because delivery state is per
  device."
- Trade-off: we depend on Clerk being up for sign-in (not for already-valid tokens: verification
  uses cached public keys).

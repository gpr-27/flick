# ADR-0020: Clerk sign-in lives inside Flick, and the profile is Flick's

- **Status:** Accepted (2026-10-27). Refines ADR-0010.
- **Related:** ADR-0010

## Context

With default settings Clerk sends people to its hosted Account Portal to sign in or sign up. A person who tried to sign
in with an account that Flick had not seen was sent to the portal and asked to create a second account, which looked like
a bug. Also, a name or photo could be changed in two places (Flick and Clerk) and drift apart.

## Decision

- The web app mounts Clerk's components on its own routes and tells Clerk where they are:
  `signInUrl="/sign-in"`, `signUpUrl="/sign-up"`, fallback redirects to `/`, and `afterSignOutUrl="/"`. Every step of
  sign-in and sign-up stays on the Flick domain. After Clerk finishes, `AfterSignIn` sends the person to where they were
  going (`redirect_url`, accepted only for same-origin paths) or to `/`.
- **Username is optional in Clerk.** The API creates the local user on first sight and picks a username from Clerk's
  username or the start of the email, adding a short suffix if taken. **Passkeys** can be enabled in the Clerk dashboard.
- **The profile belongs to Flick.** `users.display_name`, `username`, `about` and `avatar_url` are the truth. Editing the
  profile calls `PATCH /users/me` first; only then does the client push the name and picture to the Clerk user
  (`pushProfileToClerk`), and a Clerk failure never undoes the Flick save. Flick stays the source of truth: a name set in Flick
  is copied to Clerk, not the other way round on every request. Other people see the new name live (`user_updated`).
- Sign-out clears the per-browser device registration, so the next sign-in registers a fresh device.

## Alternatives

- **Use the hosted Account Portal.** Less code, but a second account screen, a different look and a redirect off-domain.
- **Clerk as the profile store.** Chat data would depend on Clerk's availability and rate limits for every name lookup.

## Trade-offs

The two profile copies can differ briefly if a Clerk call fails. The `/sign-in` and `/sign-up` paths must also be set in
the Clerk dashboard (see [`../operations/deployment.md`](../operations/deployment.md)), otherwise a redirect loop is
possible.

## Consequences

- Troubleshooting entries for sign-in loops and 401 after login exist in the runbook.
- Docs: [`../security/auth.md`](../security/auth.md), [`../features/profile.md`](../features/profile.md).

# ADR-0010: Clerk for login (no custom auth)

- **Status:** Accepted (2026-10-24). Replaces the earlier plan for custom auth with rotating refresh tokens.
- **Related:** ADR-0001

## Context

Login is risky to build and is not what this project is about. The old app already used Clerk.

## Decision

Use **Clerk** for sign-up, sign-in and sessions.

- The API verifies the Clerk token on every HTTP request and on the Socket.IO handshake.
- A local `users` row is mapped from the Clerk user id on first sight. All chat data refers to the local id.
- There are no passwords, refresh tokens or ws tickets in our code.
- A **limited demo account** exists for reviewers. It is not open guest access.

## Alternatives

- **Custom auth (argon2, JWT, refresh rotation).** Many details to get right and defend, with no product gain.
- **Another provider (Auth0, Supabase).** Clerk is already in use.

## Trade-offs

We depend on a third party for login. Local development needs Clerk keys. The mapping step must be idempotent.

## Consequences

- The auth module is thin: verify the token, find or create the local user.

// Login is Clerk. The browser sends a Clerk session token; this module checks it and maps the
// Clerk user to a local `users` row. See docs/security/auth.md.
export { authCacheKey, createAuth, type Auth } from './authenticate.js';
export { createClerk, type Clerk, type ClerkProfile } from './clerk.js';

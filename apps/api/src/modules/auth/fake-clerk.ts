// TEST ONLY. Lets browser (Playwright) and load (k6) tests sign in without the real Clerk service,
// which needs a person and a browser. It is switched on only by E2E_FAKE_AUTH=true and the config
// refuses that setting in production, so the real service is always used when the app is live.
import type { Clerk } from './clerk.js';

/** A fake token looks like `fake:alice`: anyone who knows a name can act as that user, so never expose this. */
export const FAKE_TOKEN_PREFIX = 'fake:';

export function createFakeClerk(): Clerk {
  return {
    verify(token) {
      const name = token.startsWith(FAKE_TOKEN_PREFIX) ? token.slice(FAKE_TOKEN_PREFIX.length) : '';
      if (!/^[A-Za-z0-9_.]{3,24}$/.test(name)) return Promise.reject(new Error('not a fake token'));
      return Promise.resolve(`fake_clerk_${name}`);
    },
    profile(clerkId) {
      const name = clerkId.replace('fake_clerk_', '');
      return Promise.resolve({
        username: name,
        email: `${name}@example.test`,
        displayName: name,
        imageUrl: null,
      });
    },
  };
}

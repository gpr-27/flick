import { createClerkClient, verifyToken } from '@clerk/backend';
import { ConfigError, type Config } from '../../config.js';

export interface ClerkProfile {
  username: string | null;
  email: string | null;
  displayName: string | null;
  imageUrl: string | null;
}

/** The only two things we ask Clerk. Tests replace this with a fake, so they never call Clerk. */
export interface Clerk {
  /** Returns the Clerk user id of a valid session token. Throws if the token is bad or expired. */
  verify: (token: string) => Promise<string>;
  /** One Clerk API call, made only when a user first appears. */
  profile: (clerkId: string) => Promise<ClerkProfile>;
}

export function createClerk(config: Config): Clerk {
  const secretKey = config.CLERK_SECRET_KEY;
  if (!secretKey)
    throw new ConfigError(
      'Invalid API configuration:\n  - CLERK_SECRET_KEY (Clerk, dashboard > API keys): is required but not set',
    );
  const client = createClerkClient({ secretKey });
  return {
    async verify(token) {
      // authorizedParties: the token must have been issued to one of our web origins.
      const claims = await verifyToken(token, {
        secretKey,
        authorizedParties: config.CORS_ORIGINS,
      });
      return claims.sub;
    },
    async profile(clerkId) {
      const u = await client.users.getUser(clerkId);
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
      return {
        username: u.username,
        email: u.primaryEmailAddress?.emailAddress ?? null,
        displayName: fullName || u.username,
        imageUrl: u.imageUrl || null,
      };
    },
  };
}

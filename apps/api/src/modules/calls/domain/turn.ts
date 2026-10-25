import { createHmac } from 'node:crypto';
import type { TurnCredentials } from '@chat/contracts';
import type { z } from 'zod';
import type { Config } from '../../../config.js';

const TTL_SECONDS = 3600;
// Used when no TURN relay is configured: enough for calls between peers on friendly networks, but
// two phones on different mobile networks usually need a relay.
const PUBLIC_STUN = 'stun:stun.l.google.com:19302';

/**
 * coturn's "TURN REST" scheme. The username is "<expiry unix time>:<user id>" and the password
 * is base64(HMAC-SHA1(secret, username)). coturn recomputes the HMAC with the same secret and
 * checks the expiry, so the API never talks to coturn and nothing is stored.
 */
export function turnCredentials(
  config: Config,
  userId: string,
  now = new Date(),
): z.infer<typeof TurnCredentials> {
  const expiresAt = new Date(now.getTime() + TTL_SECONDS * 1000);
  const { TURN_SECRET, TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = config;
  // A hosted TURN service with a fixed username and password.
  if (TURN_URLS?.length && TURN_USERNAME && TURN_CREDENTIAL) {
    return {
      ice_servers: [
        { urls: [PUBLIC_STUN] },
        { urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
      ],
      expires_at: expiresAt.toISOString(),
    };
  }
  if (!TURN_SECRET || !TURN_URLS?.length) {
    return { ice_servers: [{ urls: [PUBLIC_STUN] }], expires_at: expiresAt.toISOString() };
  }
  const username = `${Math.floor(expiresAt.getTime() / 1000)}:${userId}`;
  const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  return {
    ice_servers: [{ urls: [PUBLIC_STUN] }, { urls: TURN_URLS, username, credential }],
    expires_at: expiresAt.toISOString(),
  };
}

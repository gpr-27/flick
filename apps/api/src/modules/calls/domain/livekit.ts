import { AccessToken } from 'livekit-server-sdk';
import type { Config } from '../../../config.js';
import { ApiError } from '../../conversations/http/errors.js';

// Short on purpose: the token is only needed to connect. An open call keeps running after it
// expires, and a user who is removed from the group cannot get a new one.
const TOKEN_TTL_SECONDS = 10 * 60;

export interface LivekitSettings {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** The LiveKit settings, or a FEATURE_DISABLED error that names the missing variable. */
export function livekitSettings(config: Config): LivekitSettings {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = config;
  const missing = (name: string) =>
    new ApiError('FEATURE_DISABLED', `Group calls are off: ${name} is not set`);
  if (!LIVEKIT_URL) throw missing('LIVEKIT_URL');
  if (!LIVEKIT_API_KEY) throw missing('LIVEKIT_API_KEY');
  if (!LIVEKIT_API_SECRET) throw missing('LIVEKIT_API_SECRET');
  return { url: LIVEKIT_URL, apiKey: LIVEKIT_API_KEY, apiSecret: LIVEKIT_API_SECRET };
}

/** One LiveKit room per group conversation. */
export const roomName = (conversationId: string) => `group-${conversationId}`;

export interface IssuedToken {
  url: string;
  token: string;
  expires_at: string;
}

/** Signs a token locally (no request to LiveKit). It can join, publish and subscribe in one room. */
export type SignToken = (
  settings: LivekitSettings,
  userId: string,
  conversationId: string,
) => Promise<IssuedToken>;

export const signLivekitToken: SignToken = async (settings, userId, conversationId) => {
  const jwt = new AccessToken(settings.apiKey, settings.apiSecret, {
    identity: userId,
    ttl: TOKEN_TTL_SECONDS,
  });
  jwt.addGrant({
    roomJoin: true,
    room: roomName(conversationId),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return {
    url: settings.url,
    token: await jwt.toJwt(),
    expires_at: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
};

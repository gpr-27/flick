// ─────────────────────────────────────────────────────────────────────────
//  Centralised, zod-validated client configuration.
//
//  This is the ONLY module that reads `import.meta.env`. Everything else
//  imports `config` from here. Invalid or missing values fail fast at import
//  time with an actionable message instead of a confusing runtime error later.
// ─────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

const trimmed = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'is required'));
const optionalTrimmed = z
  .string()
  .optional()
  .transform((s) => s?.trim() ?? '');

export const envSchema = z.object({
  VITE_APP_ENV: trimmed,
  VITE_API_URL: trimmed,
  // Clerk publishable key (pk_...) for sign-in.
  VITE_CLERK_PUBLISHABLE_KEY: trimmed,
  // WebRTC. STUN falls back to a free public list; TURN is enabled by creds.
  VITE_STUN_URLS: optionalTrimmed,
  VITE_TURN_URL: optionalTrimmed,
  VITE_TURN_USERNAME: optionalTrimmed,
  VITE_TURN_CREDENTIAL: optionalTrimmed,
});

export type RawEnv = z.input<typeof envSchema>;

const toList = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

// Free public STUN servers, used when VITE_STUN_URLS is not set. STUN only
// helps peers discover their public address; it never relays media.
const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

// TURN relays media when no direct path exists (mobile data, symmetric NAT).
// With just a username + credential the relay URLs default to ExpressTURN's
// free tier over UDP and TCP. No credentials are ever committed.
const EXPRESSTURN_DEFAULT_URLS = [
  'turn:free.expressturn.com:3478',
  'turn:free.expressturn.com:3478?transport=tcp',
];

export const buildIceServers = (
  stunUrls: string,
  turnUrls: string,
  turnUser: string,
  turnCredential: string,
): RTCIceServer[] => {
  const stun = toList(stunUrls);
  const servers: RTCIceServer[] = (stun.length ? stun : DEFAULT_STUN_URLS).map((urls) => ({
    urls,
  }));
  if (turnUser && turnCredential) {
    const provided = toList(turnUrls);
    for (const urls of provided.length ? provided : EXPRESSTURN_DEFAULT_URLS) {
      servers.push({ urls, username: turnUser, credential: turnCredential });
    }
  }
  return servers;
};

const currentOrigin = (): string =>
  typeof location === 'undefined' ? 'http://localhost' : location.origin;

/**
 * The Socket.IO server is the API itself. VITE_API_URL may carry a path ("/api"), but Socket.IO
 * reads a path in the URL as a namespace, so only the origin is used.
 */
export const socketOrigin = (apiUrl: string): string => new URL(apiUrl, currentOrigin()).origin;

export interface AppConfig {
  readonly env: string;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly apiUrl: string;
  readonly clerkPublishableKey: string;
  readonly socketUrl: string;
  readonly webrtc: { readonly hasTurn: boolean; readonly iceServers: readonly RTCIceServer[] };
  readonly http: { readonly tunnelHeaders: Readonly<Record<string, string>> };
}

export const parseConfig = (raw: RawEnv): AppConfig => {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `   - ${i.path.join('.')} ${i.message}`);
    const message = [
      'Invalid web client configuration; the app cannot start:',
      ...lines,
      '   Set these VITE_* variables in the repo-root .env (see .env.example) and reload.',
    ].join('\n');
    throw new Error(message);
  }
  const e = result.data;
  return Object.freeze({
    env: e.VITE_APP_ENV,
    isProduction: e.VITE_APP_ENV === 'production',
    isDevelopment: e.VITE_APP_ENV === 'development',
    apiUrl: e.VITE_API_URL,
    clerkPublishableKey: e.VITE_CLERK_PUBLISHABLE_KEY,
    socketUrl: socketOrigin(e.VITE_API_URL),
    webrtc: Object.freeze({
      hasTurn: Boolean(e.VITE_TURN_USERNAME && e.VITE_TURN_CREDENTIAL),
      iceServers: Object.freeze(
        buildIceServers(
          e.VITE_STUN_URLS,
          e.VITE_TURN_URL,
          e.VITE_TURN_USERNAME,
          e.VITE_TURN_CREDENTIAL,
        ),
      ),
    }),
    // Sent on HTTP requests to skip ngrok's free-tier browser interstitial. Harmless on any other host.
    http: Object.freeze({ tunnelHeaders: Object.freeze({ 'ngrok-skip-browser-warning': 'true' }) }),
  });
};

const readEnv = (): RawEnv => {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    VITE_APP_ENV: env.VITE_APP_ENV ?? '',
    VITE_API_URL: env.VITE_API_URL ?? '',
    VITE_CLERK_PUBLISHABLE_KEY: env.VITE_CLERK_PUBLISHABLE_KEY ?? '',
    VITE_STUN_URLS: env.VITE_STUN_URLS,
    VITE_TURN_URL: env.VITE_TURN_URL,
    VITE_TURN_USERNAME: env.VITE_TURN_USERNAME,
    VITE_TURN_CREDENTIAL: env.VITE_TURN_CREDENTIAL,
  };
};

export const config: AppConfig = parseConfig(readEnv());
export default config;

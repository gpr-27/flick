import { z } from 'zod';

// The only place the API reads environment variables.

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Set to true behind nginx so req.ip is the client address from X-Forwarded-For.
  TRUST_PROXY: bool.default(false),
  CORS_ORIGINS: list.default(['http://localhost:5173']),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300), // requests per minute per IP

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Object storage is optional in development: without it only uploads are unavailable.
  S3_ENDPOINT: z.url().optional(),
  // The address browsers use to reach storage; presigned URLs are built for it. Defaults to S3_ENDPOINT.
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  // Public base URL of the bucket, used for avatar links (e.g. the R2 public bucket address or a CDN
  // domain; the object key is appended directly). Without it the links are built from S3_ENDPOINT.
  S3_PUBLIC_URL: z.url().optional(),
  // MinIO needs path-style URLs (host/bucket/key); S3 and R2 use virtual-hosted style.
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // TEST ONLY: accept `Bearer fake:<name>` instead of Clerk tokens (see modules/auth/fake-clerk.ts).
  // Refused in production by loadConfig.
  E2E_FAKE_AUTH: bool.default(false),

  // Login is Clerk (dashboard > API keys). Optional here so tools and tests can load the config;
  // main.ts refuses to start without it.
  CLERK_SECRET_KEY: z.string().optional(),

  // GIF search is a server proxy so the key never reaches the browser; without it the endpoints return 503.
  GIPHY_API_KEY: z.string().optional(),

  // 1:1 calls: coturn shares TURN_SECRET with the API. Without them /calls/turn returns STUN only.
  TURN_SECRET: z.string().optional(),
  TURN_URLS: list.optional(),
  // A hosted TURN service (ExpressTURN, Metered, ...) gives one fixed username and password
  // instead of a shared secret. Set these together with TURN_URLS.
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),

  // Group calls and call links (LiveKit). Without them those endpoints return FEATURE_DISABLED.
  LIVEKIT_URL: z.url({ protocol: /^wss?$/ }).optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  // AI assistant and the @flick bot. Every key is optional; entries without a key are skipped, and
  // with none set the AI routes answer 503. Order: Anthropic, Groq (2 accounts), Gemini (2 accounts).
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  GEMINI_API_KEY_1: z.string().optional(),
  GEMINI_API_KEY_2: z.string().optional(),

  // Web Push: the browser needs the public key to subscribe. The worker sends the message pushes;
  // the API only uses the private key for "Send me a test notification" (POST /push/test).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

// Which dependency each variable belongs to, so startup errors say what to look at.
const DEPENDENCY: Partial<Record<keyof Config, string>> = {
  API_HOST: 'HTTP server',
  API_PORT: 'HTTP server',
  TRUST_PROXY: 'HTTP server',
  CORS_ORIGINS: 'HTTP server',
  RATE_LIMIT_MAX: 'rate limiting',
  DATABASE_URL: 'PostgreSQL, e.g. postgres://chat:chat@localhost:5432/chat',
  DATABASE_POOL_MAX: 'PostgreSQL',
  REDIS_URL: 'Redis, e.g. redis://localhost:6379',
  S3_ENDPOINT: 'object storage (MinIO/S3)',
  S3_BUCKET: 'object storage (MinIO/S3)',
  S3_PUBLIC_URL: 'object storage (public bucket address)',
  CLERK_SECRET_KEY: 'Clerk login',
};

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat `FOO=` (empty) as unset so the default applies.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  // Render and similar hosts tell the app its port in PORT; API_PORT wins when both are set.
  const result = schema.safeParse({ API_PORT: cleaned.PORT, ...cleaned });
  if (result.success) {
    if (result.data.NODE_ENV === 'production' && result.data.E2E_FAKE_AUTH)
      throw new ConfigError(
        'Invalid API configuration:\n  - E2E_FAKE_AUTH (test login): must not be enabled when NODE_ENV=production',
      );
    // The localhost default is for development only; in production it would silently lock everyone out.
    if (result.data.NODE_ENV === 'production' && !cleaned.CORS_ORIGINS)
      throw new ConfigError(
        'Invalid API configuration:\n  - CORS_ORIGINS (HTTP server): is required when NODE_ENV=production (the web app origin)',
      );
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0]) as keyof Config;
    const problem = cleaned[name] === undefined ? 'is required but not set' : issue.message;
    return `  - ${name} (${DEPENDENCY[name] ?? 'runtime'}): ${problem}`;
  });
  throw new ConfigError(`Invalid API configuration:\n${lines.join('\n')}`);
}

/** Object storage settings, or undefined when they are not all set. */
export function s3Config(config: Config) {
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return undefined;
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: S3_BUCKET,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  };
}

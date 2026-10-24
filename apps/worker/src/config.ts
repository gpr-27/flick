import { z } from 'zod';

// The only place the worker reads environment variables.

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // The worker has no public HTTP API; this port only serves /metrics and health probes.
  WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9465),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Object storage is optional: without it the abandoned-upload sweep is not scheduled.
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Web Push is optional: without the keys, notifications go to a simulated log provider.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // A mailto: or https: contact that push services can use to reach us.
  VAPID_SUBJECT: z.string().optional(),
});

const checked = schema.superRefine((env, ctx) => {
  const some = env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY;
  for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
    if (some && !env[name]) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'is required when Web Push is on' });
    }
  }
});

export type Config = z.infer<typeof schema>;

const DEPENDENCY: Partial<Record<keyof Config, string>> = {
  WORKER_METRICS_PORT: 'metrics server',
  DATABASE_URL: 'PostgreSQL, e.g. postgres://chat:chat@localhost:5432/chat',
  DATABASE_POOL_MAX: 'PostgreSQL',
  REDIS_URL: 'Redis, e.g. redis://localhost:6379',
  VAPID_PUBLIC_KEY: 'Web Push',
  VAPID_PRIVATE_KEY: 'Web Push',
  VAPID_SUBJECT: 'Web Push, e.g. mailto:ops@example.com',
};

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = checked.safeParse(cleaned);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0]) as keyof Config;
    const problem = cleaned[name] === undefined ? 'is required but not set' : issue.message;
    return `  - ${name} (${DEPENDENCY[name] ?? 'runtime'}): ${problem}`;
  });
  throw new ConfigError(`Invalid worker configuration:\n${lines.join('\n')}`);
}

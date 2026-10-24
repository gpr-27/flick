import { z } from 'zod';

// Environment for the migrate and seed commands. Apps build their own pool from their own config.
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a URL, e.g. postgres://chat:chat@localhost:5432/chat'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): z.infer<typeof schema> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return parsed.data;
}

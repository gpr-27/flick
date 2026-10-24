import { pino } from 'pino';

// Same rule as the API: credentials and message content never reach the logs.
const SECRET_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'ticket',
  'body',
  'text',
];
const redactPaths = SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]);

export function createLogger(level: string) {
  return pino({
    level,
    base: { service: 'worker' },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
  });
}

export type Logger = ReturnType<typeof createLogger>;

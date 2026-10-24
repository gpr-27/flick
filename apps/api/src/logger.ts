import type { FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';

// Fields that must never reach the logs: credentials, cookies and message content.
const SECRET_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'ticket',
  'body',
  'text',
];

export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf"]',
  'res.headers["set-cookie"]',
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

// Typed as Fastify's logger interface so the Fastify instance keeps its default generic type.
export function createLogger(level: string): FastifyBaseLogger {
  return pino({
    level,
    base: { service: 'api' },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
  });
}

export type Logger = FastifyBaseLogger;

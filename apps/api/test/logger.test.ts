import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { redactPaths } from '../src/logger.js';

describe('log redaction', () => {
  it('hides credentials, cookies and message text', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: redactPaths, censor: '[REDACTED]' } },
      { write: (l: string) => lines.push(l) },
    );
    logger.info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'rt=1', 'user-agent': 'ua' } },
      user: { password: 'hunter2' },
      message: { body: 'hello', seq: 4 },
    });
    const line = lines.join('');
    for (const secret of ['Bearer abc', 'rt=1', 'hunter2', 'hello'])
      expect(line).not.toContain(secret);
    expect(line).toContain('"user-agent":"ua"');
    expect(line).toContain('"seq":4');
  });
});

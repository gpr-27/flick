import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ErrorBody,
  isForward,
  makeError,
  tickState,
  utf8ByteLength,
} from '../src/index.js';

describe('error codes', () => {
  it('classifies transient failures as retryable and the rest as permanent', () => {
    for (const code of ['RATE_LIMITED', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'INTERNAL'] as const) {
      expect(ERROR_CODES[code].retryable, code).toBe(true);
    }
    for (const code of [
      'VALIDATION_FAILED',
      'FORBIDDEN',
      'NOT_A_MEMBER',
      'NOT_FOUND',
      'PAYLOAD_TOO_LARGE',
    ] as const) {
      expect(ERROR_CODES[code].retryable, code).toBe(false);
    }
  });

  it('makeError takes retryable from the table', () => {
    const error = makeError('RATE_LIMITED', 'Slow down.', { retry_after_ms: 500 });
    expect(error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Slow down.',
      retryable: true,
      details: { retry_after_ms: 500 },
    });
    expect(ErrorBody.parse(error)).toEqual(error);
  });
});

describe('delivery states', () => {
  it('only move forward', () => {
    expect(isForward('ACCEPTED_AND_PERSISTED', 'DELIVERED_TO_DEVICE')).toBe(true);
    expect(isForward('READ_BY_USER', 'DELIVERED_TO_DEVICE')).toBe(false);
  });

  it('ticks: delivered when every recipient has it, read when every recipient read it', () => {
    expect(tickState(10, [{ delivered_seq: 9, read_seq: 0 }])).toBe('sent');
    expect(
      tickState(10, [
        { delivered_seq: 10, read_seq: 0 },
        { delivered_seq: 12, read_seq: 3 },
      ]),
    ).toBe('delivered');
    expect(
      tickState(10, [
        { delivered_seq: 10, read_seq: 10 },
        { delivered_seq: 0, read_seq: 11 },
      ]),
    ).toBe('read');
  });
});

describe('utf8ByteLength', () => {
  it('matches TextEncoder', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'a😀b€c', '\ud800'])
      expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

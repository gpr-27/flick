/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- parsed JSON in assertions */
import { ErrorResponse } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import {
  codeForStatus,
  containsNul,
  errorBodyForStatus,
  normalizeErrorPayload,
} from '../src/http-error.js';

describe('error bodies', () => {
  it('maps HTTP statuses to the contract codes', () => {
    expect(codeForStatus(400)).toBe('VALIDATION_FAILED');
    expect(codeForStatus(401)).toBe('UNAUTHORIZED');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(413)).toBe('PAYLOAD_TOO_LARGE');
    expect(codeForStatus(415)).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(codeForStatus(429)).toBe('RATE_LIMITED');
    expect(codeForStatus(503)).toBe('SERVICE_UNAVAILABLE');
    expect(codeForStatus(500)).toBe('INTERNAL');
    expect(codeForStatus(502)).toBe('INTERNAL'); // an unknown 5xx is still a server error
    expect(codeForStatus(414)).toBe('VALIDATION_FAILED'); // an unknown 4xx is still the caller's mistake
  });

  it('builds a body the contract accepts, cuts long messages, and says whether to retry', () => {
    const body = errorBodyForStatus(429, 'x'.repeat(5000), 'req-1');
    expect(ErrorResponse.safeParse({ error: body }).success).toBe(true);
    expect(body.message.length).toBeLessThanOrEqual(300);
    expect(body.retryable).toBe(true);
    expect(errorBodyForStatus(400, '').message).toBe('Request failed');
    expect(errorBodyForStatus(400, 'bad').retryable).toBe(false);
  });
});

describe('normalizeErrorPayload', () => {
  const standard = JSON.stringify({
    error: { code: 'NOT_FOUND', message: 'nope', retryable: false },
  });

  it('leaves a standard error alone', () => {
    expect(normalizeErrorPayload(404, standard, 'r')).toBeNull();
  });

  it('leaves anything that is not an error body alone', () => {
    expect(normalizeErrorPayload(400, 'not json', 'r')).toBeNull();
    expect(normalizeErrorPayload(400, '{"ok":true}', 'r')).toBeNull();
    expect(normalizeErrorPayload(400, 'null', 'r')).toBeNull();
    expect(normalizeErrorPayload(400, '[1]', 'r')).toBeNull();
  });

  it('rewrites a package error ({ error: "ai_unavailable", message }) using the name as the code when it is one of ours', () => {
    const out = JSON.parse(
      normalizeErrorPayload(
        503,
        JSON.stringify({ error: 'ai_unavailable', message: 'down' }),
        'r',
      )!,
    );
    expect(ErrorResponse.safeParse(out).success).toBe(true);
    expect(out.error).toMatchObject({ code: 'AI_UNAVAILABLE', message: 'down', retryable: true });
  });

  it('keeps an unknown package error name as details.reason and takes the code from the status', () => {
    const out = JSON.parse(
      normalizeErrorPayload(422, JSON.stringify({ error: 'preview_unavailable' }), 'r')!,
    );
    expect(ErrorResponse.safeParse(out).success).toBe(true);
    expect(out.error.code).toBe('VALIDATION_FAILED');
    expect(out.error.details).toEqual({ reason: 'preview_unavailable' });
    expect(out.error.message).toBe('preview_unavailable');
  });

  it('rewrites the old { error: { message, requestId } } shape', () => {
    const out = JSON.parse(
      normalizeErrorPayload(
        401,
        JSON.stringify({ error: { message: 'Unauthorized', requestId: 'req-9' } }),
        'req-9',
      )!,
    );
    expect(out.error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
      retryable: false,
      requestId: 'req-9',
    });
  });
});

describe('containsNul', () => {
  it('finds U+0000 in strings, nested objects and arrays', () => {
    expect(containsNul('a\u0000b')).toBe(true);
    expect(containsNul({ a: { b: ['x', 'y\u0000'] } })).toBe(true);
    expect(containsNul(['ok', { deep: 'also\u0000' }])).toBe(true);
  });

  it('is false for everything else, including numbers, null and very deep input', () => {
    expect(containsNul('plain')).toBe(false);
    expect(containsNul({ a: 1, b: null, c: [true, 'x'] })).toBe(false);
    expect(containsNul(undefined)).toBe(false);
    let deep: unknown = 'x\u0000';
    for (let i = 0; i < 100; i++) deep = { next: deep };
    expect(containsNul(deep)).toBe(false); // gives up past 64 levels instead of recursing without end
  });
});

import { describe, expect, it } from 'vitest';
import { looksLikeScam, scamScore } from './scam';

describe('scamScore', () => {
  it('passes ordinary messages', () => {
    expect(looksLikeScam('Hey, are we still on for lunch tomorrow?')).toBe(false);
    expect(looksLikeScam('Here is the doc: https://github.com/a/b')).toBe(false);
  });
  it('catches prize and code scams', () => {
    expect(looksLikeScam('Congratulations you won a free iPhone! Claim your prize now')).toBe(true);
    expect(looksLikeScam('Please verify your account and send the OTP code')).toBe(true);
  });
  it('counts a dangerous link', () => {
    const r = scamScore('urgent: http://192.168.1.1/login');
    expect(r.reasons).toContain('contains a suspicious link');
    expect(r.score).toBeGreaterThanOrEqual(3);
  });
});

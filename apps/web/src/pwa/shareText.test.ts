import { describe, expect, it } from 'vitest';
import { sharedTextFrom } from './shareText';

describe('sharedTextFrom', () => {
  it('joins title, text and url', () => {
    expect(sharedTextFrom('?title=Hi&text=Look&url=https%3A%2F%2Fa.b')).toBe(
      'Hi\nLook\nhttps://a.b',
    );
  });
  it('keeps a link that is in both text and url once', () => {
    expect(sharedTextFrom('?text=https%3A%2F%2Fa.b&url=https%3A%2F%2Fa.b')).toBe('https://a.b');
  });
  it('is empty with nothing shared', () => {
    expect(sharedTextFrom('')).toBe('');
  });
});

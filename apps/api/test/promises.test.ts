import { describe, expect, it } from 'vitest';
import { detectPromise } from '../src/modules/productivity/promises.js';

describe('detectPromise', () => {
  it('finds a promise with a day', () => {
    expect(detectPromise('I will send you the report by Tuesday')).toEqual({ whenHint: 'tuesday' });
  });
  it('finds a promise without a time', () => {
    expect(detectPromise("I'll get back to you about the invoice")).toEqual({ whenHint: null });
  });
  it('ignores questions and ordinary text', () => {
    expect(detectPromise('Will you send the report by Tuesday?')).toBeNull();
    expect(detectPromise('The weather is nice today, right')).toBeNull();
    expect(detectPromise('I will, thanks')).toBeNull();
  });
});

describe('event content storage', () => {
  it('stores the title as body text and round-trips', async () => {
    const { toStored } = await import('../src/modules/messages/domain/content.js');
    const stored = toStored({
      type: 'event',
      title: 'Dinner',
      starts_at: '2026-11-01T18:00:00Z',
      place: 'Home',
    });
    expect(stored.bodyText).toBe('Dinner');
    expect(stored.content).toEqual({ starts_at: '2026-11-01T18:00:00Z', place: 'Home' });
  });
});

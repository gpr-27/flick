import { describe, expect, it } from 'vitest';
import { bannerFor } from './connectionBanner';

describe('bannerFor with queued messages', () => {
  it('says how many messages are waiting', () => {
    expect(bannerFor('offline', 2)?.text).toContain('2 messages waiting to send');
    expect(bannerFor('offline', 1)?.text).toContain('1 message waiting');
  });
});

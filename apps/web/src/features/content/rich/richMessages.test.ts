import { describe, expect, it } from 'vitest';
import { contactText, locationText, parseContact, parseLocation } from './richMessages';

describe('location text', () => {
  it('one-off round trip', () => {
    const t = locationText(12.34567, -76.5, { live: false });
    expect(parseLocation(t)).toEqual({
      lat: 12.34567,
      lon: -76.5,
      live: false,
      ended: false,
      until: null,
    });
  });
  it('live and ended', () => {
    const d = new Date(2026, 0, 1, 14, 30);
    expect(parseLocation(locationText(1, 2, { live: true, until: d }))).toMatchObject({
      live: true,
      ended: false,
      until: '14:30',
    });
    expect(parseLocation(locationText(1, 2, { live: true, ended: true }))).toMatchObject({
      live: true,
      ended: true,
    });
  });
  it('ignores ordinary text', () => {
    expect(parseLocation('hello')).toBeNull();
  });
});

describe('contact text', () => {
  it('round trip', () => {
    const t = contactText('Ada (L)', 'ada', 'https://flick.app');
    expect(parseContact(t)).toEqual({ name: 'Ada  L', username: 'ada' });
    expect(parseContact('👤 x')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { enterAction, inQuietHours, mayAutoDownload, VIDEO_MAX_BITRATE } from './policy';

const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m);
const quiet = (from: string, to: string, on = true) => ({
  quietHoursOn: on,
  quietFrom: from,
  quietTo: to,
});

describe('inQuietHours', () => {
  it('is never quiet when switched off', () => {
    expect(inQuietHours(quiet('00:00', '23:59', false), at(12))).toBe(false);
  });
  it('a same-day window', () => {
    expect(inQuietHours(quiet('13:00', '15:00'), at(13))).toBe(true);
    expect(inQuietHours(quiet('13:00', '15:00'), at(14, 59))).toBe(true);
    expect(inQuietHours(quiet('13:00', '15:00'), at(15))).toBe(false);
    expect(inQuietHours(quiet('13:00', '15:00'), at(12, 59))).toBe(false);
  });
  it('a window that crosses midnight', () => {
    const night = quiet('22:00', '07:00');
    expect(inQuietHours(night, at(23))).toBe(true);
    expect(inQuietHours(night, at(3))).toBe(true);
    expect(inQuietHours(night, at(6, 59))).toBe(true);
    expect(inQuietHours(night, at(7))).toBe(false);
    expect(inQuietHours(night, at(12))).toBe(false);
  });
  it('an empty window is never quiet', () => {
    expect(inQuietHours(quiet('08:00', '08:00'), at(8))).toBe(false);
  });
});

describe('enterAction', () => {
  const key = (extra: object = {}) => ({
    key: 'Enter',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  });
  it('Enter sends when "Enter sends" is on, Shift+Enter makes a new line', () => {
    expect(enterAction(true, key())).toBe('send');
    expect(enterAction(true, key({ shiftKey: true }))).toBe('default');
  });
  it('Enter makes a new line when it is off', () => {
    expect(enterAction(false, key())).toBe('default');
    expect(enterAction(false, key({ shiftKey: true }))).toBe('default');
  });
  it('Ctrl or Cmd + Enter always sends', () => {
    expect(enterAction(false, key({ ctrlKey: true }))).toBe('send');
    expect(enterAction(false, key({ metaKey: true }))).toBe('send');
    expect(enterAction(true, key({ ctrlKey: true }))).toBe('send');
  });
  it('other keys and IME composition are left alone', () => {
    expect(enterAction(false, key({ key: 'a' }))).toBe('default');
    expect(enterAction(false, key({ isComposing: true }))).toBe('default');
  });
});

describe('mayAutoDownload', () => {
  it('"always" and "never" ignore the connection', () => {
    expect(mayAutoDownload('always', { type: 'cellular' })).toBe(true);
    expect(mayAutoDownload('never', { type: 'wifi' })).toBe(false);
  });
  it('"wifi" loads on Wi-Fi and Ethernet, not on mobile data or Data Saver', () => {
    expect(mayAutoDownload('wifi', { type: 'wifi' })).toBe(true);
    expect(mayAutoDownload('wifi', { type: 'ethernet' })).toBe(true);
    expect(mayAutoDownload('wifi', { type: 'cellular' })).toBe(false);
    expect(mayAutoDownload('wifi', { type: 'wifi', saveData: true })).toBe(false);
  });
  it('"wifi" falls back to the speed class, then to loading', () => {
    expect(mayAutoDownload('wifi', { effectiveType: '4g' })).toBe(true);
    expect(mayAutoDownload('wifi', { effectiveType: '2g' })).toBe(false);
    expect(mayAutoDownload('wifi', undefined)).toBe(true);
  });
});

describe('VIDEO_MAX_BITRATE', () => {
  it('matches the labels in Settings', () => {
    expect(VIDEO_MAX_BITRATE).toEqual({ low: 400_000, auto: 1_200_000, high: 2_500_000 });
  });
});

import { describe, expect, it } from 'vitest';
import { deviceName } from '../src/modules/devices/domain/name.js';

describe('deviceName', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      'Edge on Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
  ])('%s -> %s', (agent, expected) => {
    expect(deviceName(agent)).toBe(expected);
  });

  it('falls back when there is nothing to read', () => {
    expect(deviceName(undefined)).toBe('Unknown device');
    expect(deviceName('curl/8.0')).toBe('Unknown device');
    expect(deviceName('SomethingElse (Linux)')).toBe('Linux');
  });
});

// Client configuration: validation, STUN/TURN assembly and the socket origin.
import { describe, expect, it } from 'vitest';
import { buildIceServers, config, parseConfig, socketOrigin, type RawEnv } from './env';

const valid: RawEnv = {
  VITE_APP_ENV: 'production',
  VITE_API_URL: 'https://api.flick.test/api',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x',
  VITE_STUN_URLS: undefined,
  VITE_TURN_URL: undefined,
  VITE_TURN_USERNAME: undefined,
  VITE_TURN_CREDENTIAL: undefined,
};

describe('parseConfig', () => {
  it('reads the required values and the environment flags', () => {
    const c = parseConfig(valid);
    expect(c).toMatchObject({
      env: 'production',
      isProduction: true,
      isDevelopment: false,
      apiUrl: 'https://api.flick.test/api',
      clerkPublishableKey: 'pk_live_x',
    });
    expect(parseConfig({ ...valid, VITE_APP_ENV: 'development' })).toMatchObject({
      isProduction: false,
      isDevelopment: true,
    });
    expect(parseConfig({ ...valid, VITE_APP_ENV: 'staging' })).toMatchObject({
      isProduction: false,
      isDevelopment: false,
    });
  });

  it('trims whitespace', () => {
    expect(parseConfig({ ...valid, VITE_API_URL: '  https://x.test/api  ' }).apiUrl).toBe(
      'https://x.test/api',
    );
  });

  it.each(['VITE_APP_ENV', 'VITE_API_URL', 'VITE_CLERK_PUBLISHABLE_KEY'] as const)(
    '%s is required, and the message names it',
    (key) => {
      expect(() => parseConfig({ ...valid, [key]: '' })).toThrow(new RegExp(`${key} is required`));
      expect(() => parseConfig({ ...valid, [key]: '   ' })).toThrow(/cannot start/);
    },
  );

  it('lists every problem at once and says where to fix it', () => {
    expect(() =>
      parseConfig({ ...valid, VITE_API_URL: '', VITE_CLERK_PUBLISHABLE_KEY: '' }),
    ).toThrow(/VITE_API_URL is required[\s\S]*VITE_CLERK_PUBLISHABLE_KEY is required[\s\S]*\.env/);
  });

  it('the result cannot be changed afterwards', () => {
    const c = parseConfig(valid);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.webrtc)).toBe(true);
    expect(Object.isFrozen(c.webrtc.iceServers)).toBe(true);
    expect(c.http.tunnelHeaders).toEqual({ 'ngrok-skip-browser-warning': 'true' });
  });

  it('hasTurn needs both a username and a credential', () => {
    expect(parseConfig(valid).webrtc.hasTurn).toBe(false);
    expect(parseConfig({ ...valid, VITE_TURN_USERNAME: 'u' }).webrtc.hasTurn).toBe(false);
    expect(parseConfig({ ...valid, VITE_TURN_CREDENTIAL: 'c' }).webrtc.hasTurn).toBe(false);
    expect(
      parseConfig({ ...valid, VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'c' }).webrtc.hasTurn,
    ).toBe(true);
  });

  it('the test environment has the placeholder config', () => {
    expect(config.env).toBe('test');
    expect(config.apiUrl).toBe('http://api.test/api');
    expect(config.socketUrl).toBe('http://api.test');
  });
});

describe('buildIceServers', () => {
  it('uses the public STUN list by default and no TURN', () => {
    const servers = buildIceServers('', '', '', '');
    expect(servers.length).toBeGreaterThanOrEqual(3);
    expect(servers.every((s) => typeof s.urls === 'string' && s.urls.startsWith('stun:'))).toBe(
      true,
    );
    expect(servers.some((s) => s.username)).toBe(false);
  });

  it('takes a configured STUN list, trimming, dropping blanks and duplicates', () => {
    expect(buildIceServers(' stun:a:1 , ,stun:b:2,stun:a:1', '', '', '')).toEqual([
      { urls: 'stun:a:1' },
      { urls: 'stun:b:2' },
    ]);
  });

  it('adds TURN only with credentials, using the free default relay when no URL is given', () => {
    const servers = buildIceServers('stun:a:1', '', 'user', 'pass');
    const turn = servers.filter((s) => s.username);
    expect(turn.map((s) => s.urls)).toEqual([
      'turn:free.expressturn.com:3478',
      'turn:free.expressturn.com:3478?transport=tcp',
    ]);
    expect(turn.every((s) => s.username === 'user' && s.credential === 'pass')).toBe(true);
  });

  it('uses the configured TURN URLs when given', () => {
    const servers = buildIceServers(
      'stun:a:1',
      'turn:t1:3478, turn:t2:3478?transport=tcp',
      'u',
      'c',
    );
    expect(servers.slice(1).map((s) => s.urls)).toEqual([
      'turn:t1:3478',
      'turn:t2:3478?transport=tcp',
    ]);
  });

  it('TURN URLs without credentials are ignored (they would be refused)', () => {
    expect(buildIceServers('stun:a:1', 'turn:t:3478', '', '')).toEqual([{ urls: 'stun:a:1' }]);
  });
});

describe('socketOrigin', () => {
  it.each([
    ['https://api.flick.test/api', 'https://api.flick.test'],
    ['http://localhost:4000/api/', 'http://localhost:4000'],
    ['https://api.flick.test', 'https://api.flick.test'],
    ['/api', 'http://localhost:3000'],
  ])('%s -> %s', (url, origin) => {
    expect(socketOrigin(url)).toBe(origin);
  });
});

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { turnCredentials } from '../src/modules/calls/domain/turn.js';
import { TEST_ENV } from './helpers.js';

const userId = '5b0f0a54-27a3-4d4c-9b57-0d0f3f1b2c11';

describe('TURN credentials', () => {
  it('signs "<expiry>:<user id>" with HMAC-SHA1, the way coturn checks it', () => {
    const config = loadConfig({
      ...TEST_ENV,
      TURN_SECRET: 'shared-secret',
      TURN_URLS: 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349',
    });
    const now = new Date('2026-10-24T10:00:00Z');
    const creds = turnCredentials(config, userId, now);

    const turn = creds.ice_servers.find((s) => s.credential);
    expect(turn?.urls).toEqual([
      'turn:turn.example.com:3478?transport=udp',
      'turns:turn.example.com:5349',
    ]);
    const expiry = Math.floor(now.getTime() / 1000) + 3600;
    expect(turn?.username).toBe(`${expiry}:${userId}`);
    const expected = createHmac('sha1', 'shared-secret').update(turn!.username!).digest('base64');
    expect(turn?.credential).toBe(expected);
    expect(creds.expires_at).toBe(new Date(expiry * 1000).toISOString());
  });

  it("hands out a hosted TURN service's fixed username and password with its URLs", () => {
    const config = loadConfig({
      ...TEST_ENV,
      TURN_URLS: 'turn:relay.example.com:80,turns:relay.example.com:443?transport=tcp',
      TURN_USERNAME: 'service-user',
      TURN_CREDENTIAL: 'service-password',
    });
    const creds = turnCredentials(config, userId);
    const turn = creds.ice_servers.find((s) => s.credential);
    expect(turn).toEqual({
      urls: ['turn:relay.example.com:80', 'turns:relay.example.com:443?transport=tcp'],
      username: 'service-user',
      credential: 'service-password',
    });
    expect(creds.ice_servers[0]?.urls[0]).toMatch(/^stun:/); // the public STUN stays first
  });

  it('needs the URLs and both halves of the login: a partial setup is STUN only', () => {
    for (const partial of [
      { TURN_USERNAME: 'u', TURN_CREDENTIAL: 'c' }, // no URLs
      { TURN_URLS: 'turn:relay.example.com:80', TURN_USERNAME: 'u' }, // no credential
      { TURN_URLS: 'turn:relay.example.com:80', TURN_CREDENTIAL: 'c' }, // no username
    ]) {
      const creds = turnCredentials(loadConfig({ ...TEST_ENV, ...partial }), userId);
      expect(creds.ice_servers).toHaveLength(1);
      expect(creds.ice_servers[0]?.credential).toBeUndefined();
    }
  });

  it('falls back to STUN only, without credentials, when coturn is not configured', () => {
    const creds = turnCredentials(loadConfig(TEST_ENV), userId);
    expect(creds.ice_servers).toHaveLength(1);
    expect(creds.ice_servers[0]?.urls[0]).toMatch(/^stun:/);
    expect(creds.ice_servers[0]?.credential).toBeUndefined();
  });
});

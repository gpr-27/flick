import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeServices, type FakeApi } from '../../../test/fakes';

const STUN = { urls: ['stun:stun.l.google.com:19302'] };
const BUILD_STUN = { urls: 'stun:stun.cloudflare.com:3478' };
const BUILD_TURN = { urls: 'turn:free.expressturn.com:3478', username: 'u', credential: 'c' };

// The build's own settings (VITE_*): the tests flip `hasTurn` to simulate a build with or without
// a relay login.
const buildConfig = vi.hoisted(() => ({ webrtc: { hasTurn: false, iceServers: [] as unknown[] } }));
vi.mock('@/config/env', () => ({ config: buildConfig }));

import { fetchIceServers } from './iceServers';

let api: FakeApi;
beforeEach(() => {
  ({ api } = installFakeServices());
  buildConfig.webrtc = { hasTurn: false, iceServers: [BUILD_STUN, BUILD_TURN] };
});

describe('fetchIceServers', () => {
  it('uses the server list as it is when the server has its own relay login', async () => {
    const server = [STUN, { urls: ['turn:relay.example.com:80'], username: 's', credential: 'p' }];
    api.call.mockResolvedValue({ ice_servers: server, expires_at: 'x' });
    buildConfig.webrtc.hasTurn = true;
    expect(await fetchIceServers()).toEqual(server);
  });

  it('adds the build relay login when the server only offers STUN', async () => {
    api.call.mockResolvedValue({ ice_servers: [STUN], expires_at: 'x' });
    buildConfig.webrtc.hasTurn = true;
    expect(await fetchIceServers()).toEqual([STUN, BUILD_TURN]);
  });

  it('stays STUN only when neither side has a relay login', async () => {
    api.call.mockResolvedValue({ ice_servers: [STUN], expires_at: 'x' });
    expect(await fetchIceServers()).toEqual([STUN]);
  });

  it('falls back to the build list when the server cannot be reached', async () => {
    api.call.mockRejectedValue(new Error('offline'));
    expect(await fetchIceServers()).toEqual([BUILD_STUN, BUILD_TURN]);
  });
});

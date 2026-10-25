import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import { fakeApi, installFakeServices } from '../../../test/fakes';
import { endpointHash, refreshPushSubscription } from './pushSync';

afterEach(removeFakePush);
beforeEach(() => {
  localStorage.clear();
});

type Status = { subscribed: boolean; hash: string | null };
const setup = ({ subscribed, hash }: Status, serverReady = true) => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) => {
    if (endpoint === ENDPOINTS.push.status)
      return Promise.resolve({
        server_ready: serverReady,
        this_device: { subscribed, endpoint_hash: hash, last_status: null },
        other_devices: 0,
      });
    if (endpoint === ENDPOINTS.push.vapidKey) return Promise.resolve({ public_key: 'AQID' });
    return Promise.resolve(undefined);
  });
  installFakeServices(undefined, api);
  return api;
};

describe('refreshPushSubscription', () => {
  it('does nothing until the person has allowed notifications', async () => {
    const api = setup({ subscribed: false, hash: null });
    installFakePush({ permission: 'default' });
    expect(await refreshPushSubscription()).toBe('no_permission');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('subscribes again and tells the server when the browser lost its subscription', async () => {
    const api = setup({ subscribed: false, hash: null });
    const fake = installFakePush({ permission: 'granted', subscribed: false });
    expect(await refreshPushSubscription()).toBe('registered');
    expect(fake.pushManager.subscribe).toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.subscribe, expect.anything());
  });

  it('tells the server when it does not know the current endpoint', async () => {
    const api = setup({ subscribed: true, hash: 'stale-endpoint0' });
    installFakePush({ permission: 'granted', subscribed: true });
    expect(await refreshPushSubscription()).toBe('registered');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.subscribe, expect.anything());
  });

  it('leaves everything alone when the server already has the endpoint', async () => {
    const hash = await endpointHash('https://push.example/abc');
    const api = setup({ subscribed: true, hash });
    installFakePush({ permission: 'granted', subscribed: true });
    expect(await refreshPushSubscription()).toBe('in_sync');
    expect(api.call).not.toHaveBeenCalledWith(ENDPOINTS.push.subscribe, expect.anything());
  });

  it('respects a person who switched push off', async () => {
    setup({ subscribed: false, hash: null });
    installFakePush({ permission: 'granted' });
    localStorage.setItem('flick-push-off', '1');
    expect(await refreshPushSubscription()).toBe('turned_off');
  });

  it('does not subscribe when the server has no VAPID keys', async () => {
    setup({ subscribed: false, hash: null }, false);
    const fake = installFakePush({ permission: 'granted' });
    expect(await refreshPushSubscription()).toBe('server_not_ready');
    expect(fake.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

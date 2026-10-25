import { afterEach, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import { fakeApi, installFakeServices } from '../../../test/fakes';
import { PushError, disablePush, enablePush, getPushState, urlBase64ToBytes } from './push';

afterEach(removeFakePush);

const setup = () => {
  const api = fakeApi();
  installFakeServices(undefined, api);
  return api;
};

describe('enablePush', () => {
  it('asks permission, subscribes with the VAPID key and registers it with the server', async () => {
    const api = setup();
    const fake = installFakePush();
    await enablePush('AQID');

    expect(fake.requestPermission).toHaveBeenCalledOnce();
    expect(fake.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.subscribe, {
      body: {
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'p', auth: 'a' },
        prefs: { previews: true, quiet: null },
      },
    });
  });

  it('fails with "denied" when the user blocks permission, and does not subscribe', async () => {
    setup();
    const fake = installFakePush({ answer: 'denied' });
    await expect(enablePush('AQID')).rejects.toMatchObject({ failure: 'denied' });
    expect(fake.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('fails with "no_vapid_key" before asking for permission', async () => {
    setup();
    const fake = installFakePush();
    await expect(enablePush(null)).rejects.toMatchObject({ failure: 'no_vapid_key' });
    expect(fake.requestPermission).not.toHaveBeenCalled();
  });

  it('fails with "unsupported" when the browser has no push', async () => {
    setup();
    await expect(enablePush('AQID')).rejects.toBeInstanceOf(PushError);
    await expect(enablePush('AQID')).rejects.toMatchObject({ failure: 'unsupported' });
  });

  it('fails with "failed" when the server rejects the subscription', async () => {
    const api = setup();
    api.call.mockRejectedValue(new Error('500'));
    installFakePush();
    await expect(enablePush('AQID')).rejects.toMatchObject({ failure: 'failed' });
  });
});

describe('disablePush', () => {
  it('tells the server, then unsubscribes in the browser', async () => {
    const api = setup();
    const fake = installFakePush({ permission: 'granted', subscribed: true });
    await disablePush();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.unsubscribe, {
      body: { endpoint: 'https://push.example/abc' },
    });
    expect(fake.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('still unsubscribes locally when the server call fails, and reports the failure', async () => {
    const api = setup();
    api.call.mockRejectedValue(new Error('offline'));
    const fake = installFakePush({ permission: 'granted', subscribed: true });
    await expect(disablePush()).rejects.toMatchObject({ failure: 'failed' });
    expect(fake.subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('getPushState', () => {
  it('reports each state', async () => {
    expect(await getPushState()).toBe('unsupported');
    installFakePush({ permission: 'denied' });
    expect(await getPushState()).toBe('denied');
    removeFakePush();
    installFakePush({ permission: 'default' });
    expect(await getPushState()).toBe('unsubscribed');
    removeFakePush();
    installFakePush({ permission: 'granted', subscribed: true });
    expect(await getPushState()).toBe('subscribed');
  });
});

describe('urlBase64ToBytes', () => {
  it('decodes base64url without padding', () => {
    expect(Array.from(urlBase64ToBytes('_-8'))).toEqual([255, 239]);
  });
});

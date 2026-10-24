import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { getDeviceId } from './authBridge';
import { useSessionStore } from './useSessionStore';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/lib/services', () => ({ getApi: () => api }));

const me = { id: 'u1', username: 'alice' };
const deviceClash = new ApiError({
  status: 403,
  code: 'FORBIDDEN',
  message: 'This device id belongs to another user',
  retryable: false,
});

beforeEach(() => {
  localStorage.clear();
  api.call.mockReset();
  useSessionStore.getState().reset();
});

describe('session load', () => {
  it('takes a new device id and tries once more when the server says the device belongs to another user', async () => {
    const before = getDeviceId();
    api.call.mockRejectedValueOnce(deviceClash).mockResolvedValueOnce(me);

    await useSessionStore.getState().load();

    expect(api.call).toHaveBeenCalledTimes(2);
    expect(getDeviceId()).not.toBe(before);
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', user: me });
  });

  it('does not retry other errors', async () => {
    api.call.mockRejectedValueOnce(
      new ApiError({ status: 500, code: 'INTERNAL', message: 'boom', retryable: true }),
    );

    await useSessionStore.getState().load();

    expect(api.call).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().error).toBeTruthy();
  });
});

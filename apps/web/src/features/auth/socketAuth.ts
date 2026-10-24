// What the Socket.IO handshake sends: `auth: { token, deviceId }`. Called at connect time, so
// every (re)connect carries a fresh Clerk session token.
import { getDeviceId, getSessionToken } from './authBridge';

export const getSocketAuth = async (): Promise<{ token: string; deviceId: string }> => {
  const token = await getSessionToken();
  if (!token) throw new Error('Not signed in');
  return { token, deviceId: getDeviceId() };
};

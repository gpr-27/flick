import { ApiError } from '@/lib/api';

/** A friendly sentence for every way "get a LiveKit token" can fail. */
export const groupCallErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 503 || error.status === 501 || error.code === 'FEATURE_DISABLED')
      return 'Group calls are not set up on this server yet.';
    if (error.code === 'GROUP_FULL') return 'This call is full.';
    if (error.status === 403) return 'You are not allowed to join this call.';
    if (error.status === 404 || error.status === 410) return 'This call or link no longer exists.';
    if (error.status === 429) return 'Too many attempts. Wait a moment and try again.';
    if (error.status === 0) return 'No connection. Check your network and try again.';
  }
  return 'Could not join the call. Please try again.';
};

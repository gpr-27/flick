import { notify } from '@/components/ui/notify';
import type { CallType } from '@/types/domain';

// getUserMedia is only available in a secure context (HTTPS or localhost).
export const hasMediaSupport = (): boolean =>
  typeof navigator !== 'undefined' &&
  'mediaDevices' in navigator &&
  typeof navigator.mediaDevices.getUserMedia === 'function';

export const errorName = (error: unknown): string | undefined =>
  error instanceof DOMException || error instanceof Error ? error.name : undefined;

/** Human-readable reason for a getUserMedia failure. */
export const mediaErrorMessage = (error: unknown): string => {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone permission was denied. Allow access in your browser and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera/microphone is in use by another app.';
    default:
      return 'Could not access your camera/microphone.';
  }
};

/**
 * Acquire local media. A video call on a device without a usable camera falls
 * back to audio-only so the call still connects (and still RECEIVES video).
 */
export const getLocalMedia = async (type: CallType): Promise<MediaStream> => {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
  } catch (error) {
    const name = errorName(error);
    if (type !== 'video' || name === 'NotAllowedError' || name === 'SecurityError') throw error;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    notify.info('No camera available — joining with audio only');
    return stream;
  }
};

export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

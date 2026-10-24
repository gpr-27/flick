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

/** The microphone choices from Settings > Calls. */
export interface AudioOptions {
  noiseSuppression: boolean;
  echoCancellation: boolean;
}

const DEFAULT_AUDIO: AudioOptions = { noiseSuppression: true, echoCancellation: true };

/**
 * Acquire local media. A video call on a device without a usable camera falls
 * back to audio-only so the call still connects (and still RECEIVES video).
 */
export const getLocalMedia = async (
  type: CallType,
  audio: AudioOptions = DEFAULT_AUDIO,
): Promise<MediaStream> => {
  const constraints = {
    noiseSuppression: audio.noiseSuppression,
    echoCancellation: audio.echoCancellation,
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: constraints,
      video: type === 'video',
    });
  } catch (error) {
    const name = errorName(error);
    if (type !== 'video' || name === 'NotAllowedError' || name === 'SecurityError') throw error;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    notify.info('No camera available — joining with audio only');
    return stream;
  }
};

export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Limits how much bandwidth the outgoing video may use (bits per second). Called after the call
 * is set up; a browser that does not allow it keeps its own default.
 */
export const limitVideoBitrate = async (
  peer: Pick<RTCPeerConnection, 'getSenders'>,
  maxBitrate: number,
): Promise<void> => {
  for (const sender of peer.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings.length > 0 ? params.encodings : [{}];
      for (const encoding of params.encodings) encoding.maxBitrate = maxBitrate;
      await sender.setParameters(params);
    } catch {
      // not supported yet at this point of the call: the default bitrate is used
    }
  }
};

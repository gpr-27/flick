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

// Voice quality: echo cancellation stops the other person hearing themselves, noise suppression
// removes background noise, auto gain keeps quiet and loud speakers at a similar level. Browsers
// apply these by default only sometimes, so they are asked for explicitly. Noise suppression and
// echo cancellation follow Settings > Calls.
const voiceConstraints = (audio: AudioOptions): MediaTrackConstraints => ({
  echoCancellation: audio.echoCancellation,
  noiseSuppression: audio.noiseSuppression,
  autoGainControl: true,
});

// A live call needs a picture that moves smoothly more than a sharp one. Asking the camera for
// 720p at 30 frames per second (at most) keeps the phone's camera and encoder within budget; the
// browser's default is often a larger size, which is what made the video lag on phones.
const CAMERA: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 24, max: 30 },
};

/**
 * Acquire local media. A video call on a device without a usable camera falls
 * back to audio-only so the call still connects (and still RECEIVES video).
 */
export const getLocalMedia = async (
  type: CallType,
  audio: AudioOptions = DEFAULT_AUDIO,
): Promise<MediaStream> => {
  const voice = voiceConstraints(audio);
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: voice,
      video: type === 'video' ? CAMERA : false,
    });
  } catch (error) {
    const name = errorName(error);
    if (type !== 'video' || name === 'NotAllowedError' || name === 'SecurityError') throw error;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: voice, video: false });
    notify.info('No camera available — joining with audio only');
    return stream;
  }
};

export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Caps how much video the sender pushes. Without a cap a weak connection makes the picture freeze
 * (the browser keeps the resolution and drops frames). With a cap it lowers the picture quality
 * first, which keeps the call moving. 1.2 Mbps is a clear 720p picture; audio is always kept.
 * Settings > Calls can choose a lower or higher cap.
 */
export const VIDEO_MAX_BITRATE = 1_200_000;

export async function capVideoBitrate(
  sender: RTCRtpSender,
  maxBitrate: number = VIDEO_MAX_BITRATE,
): Promise<void> {
  const params = sender.getParameters();
  const encodings = params.encodings.length > 0 ? params.encodings : [{}];
  params.encodings = encodings.map((e) => ({
    ...e,
    maxBitrate,
  }));
  params.degradationPreference = 'maintain-framerate';
  await sender.setParameters(params);
}

/**
 * Limits how much bandwidth every outgoing video may use (bits per second). A browser that does
 * not allow it keeps its own default.
 */
export const limitVideoBitrate = async (
  peer: Pick<RTCPeerConnection, 'getSenders'>,
  maxBitrate: number,
): Promise<void> => {
  for (const sender of peer.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    try {
      await capVideoBitrate(sender, maxBitrate);
    } catch {
      // not supported yet at this point of the call: the default bitrate is used
    }
  }
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_MAX_BITRATE, capVideoBitrate, getLocalMedia } from './media';

const getUserMedia = vi.fn(() => Promise.resolve({ id: 'stream' }));

beforeEach(() => {
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLocalMedia', () => {
  it('asks for echo cancellation, noise suppression and auto gain on the microphone', async () => {
    await getLocalMedia('audio');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  });
});

describe('camera request', () => {
  it('asks for a 720p picture at up to 30 frames per second, not the browser default', async () => {
    await getLocalMedia('video');
    const request = getUserMedia.mock.calls.at(-1) as unknown as [{ video: MediaTrackConstraints }];
    expect(request[0].video).toMatchObject({
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { max: 30 },
    });
  });
});

describe('capVideoBitrate', () => {
  it('caps the video bitrate and prefers keeping the frame rate over the picture size', async () => {
    const setParameters = vi.fn(() => Promise.resolve());
    const sender = {
      getParameters: () => ({ encodings: [{ rid: 'a' }] }),
      setParameters,
    } as unknown as RTCRtpSender;

    await capVideoBitrate(sender);

    expect(setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [{ rid: 'a', maxBitrate: VIDEO_MAX_BITRATE }],
        degradationPreference: 'maintain-framerate',
      }),
    );
  });

  it('works when the sender has no encodings yet', async () => {
    const setParameters = vi.fn(() => Promise.resolve());
    const sender = {
      getParameters: () => ({ encodings: [] }),
      setParameters,
    } as unknown as RTCRtpSender;

    await capVideoBitrate(sender);

    expect(setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ encodings: [{ maxBitrate: VIDEO_MAX_BITRATE }] }),
    );
  });
});

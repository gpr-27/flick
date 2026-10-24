import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFileName, formatTimer, pickVideoMime, takePhoto } from './capture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pickVideoMime', () => {
  it('prefers mp4, then webm', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (m: string) => m !== 'video/mp4' });
    expect(pickVideoMime()).toBe('video/webm;codecs=vp9,opus');
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    expect(pickVideoMime()).toBe('video/mp4');
  });
  it('is undefined when nothing can record', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false });
    expect(pickVideoMime()).toBeUndefined();
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickVideoMime()).toBeUndefined();
  });
});

describe('captureFileName', () => {
  const at = new Date('2026-10-25T04:30:12Z');
  it('is sortable and has the right extension', () => {
    expect(captureFileName('photo', 'image/jpeg', at)).toBe('photo-2026-10-25-04-30-12.jpg');
    expect(captureFileName('video', 'video/mp4', at)).toBe('video-2026-10-25-04-30-12.mp4');
    expect(captureFileName('video', 'video/webm', at)).toBe('video-2026-10-25-04-30-12.webm');
  });
});

describe('formatTimer', () => {
  it('shows mm:ss', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(65_900)).toBe('01:05');
  });
});

describe('takePhoto', () => {
  const video = (width: number, height: number) =>
    ({ videoWidth: width, videoHeight: height }) as HTMLVideoElement;

  it('is null while the camera has no picture', async () => {
    expect(await takePhoto(video(0, 0))).toBeNull();
  });

  it('draws the frame and returns a JPEG file', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob(['x'], { type: 'image/jpeg' }));
    });
    const file = await takePhoto(video(640, 480));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 480);
    expect(file?.type).toBe('image/jpeg');
    expect(file?.name).toMatch(/^photo-.*\.jpg$/);
  });

  it('is null when the canvas gives no data', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(null);
    });
    expect(await takePhoto(video(10, 10))).toBeNull();
  });
});

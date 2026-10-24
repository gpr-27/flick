import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraCapture } from './CameraCapture';
import * as capture from './capture';

const stopTrack = vi.fn();
const fakeStream = () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream;

beforeEach(() => {
  stopTrack.mockClear();
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream())) },
  });
  // jsdom does not play video or make object URLs.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = () => {
  const onClose = vi.fn();
  const onCapture = vi.fn();
  render(<CameraCapture open onClose={onClose} onCapture={onCapture} />);
  return { onClose, onCapture, user: userEvent.setup() };
};

describe('CameraCapture', () => {
  it('opens the camera without the microphone in photo mode', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: false }),
    );
  });

  it('takes a photo, lets you use it, and frees the camera', async () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    vi.spyOn(capture, 'takePhoto').mockResolvedValue(file);
    const { user, onCapture, onClose } = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByAltText('Your photo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use photo/ }));
    expect(onCapture).toHaveBeenCalledWith(file);
    expect(onClose).toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('Retake goes back to the live view', async () => {
    vi.spyOn(capture, 'takePhoto').mockResolvedValue(
      new File(['x'], 'p.jpg', { type: 'image/jpeg' }),
    );
    const { user, onCapture } = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await user.click(await screen.findByRole('button', { name: /Retake/ }));
    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('records a video, and asks for the microphone only in video mode', async () => {
    class FakeRecorder {
      state = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported = () => true;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['v'], { type: 'video/mp4' }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const { user, onCapture } = setup();
    await user.click(screen.getByRole('tab', { name: 'Video' }));
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ audio: true }),
      );
    });
    const start = await screen.findByRole('button', { name: 'Start recording' });
    await waitFor(() => {
      expect(start).toBeEnabled();
    });
    await user.click(start);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));
    await user.click(await screen.findByRole('button', { name: /Use video/ }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect((onCapture.mock.calls[0]?.[0] as File).type).toBe('video/mp4');
  });

  it('explains a denied camera', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('no', 'NotAllowedError'),
    );
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission was denied/);
  });

  it('Close button closes the sheet', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    expect(onClose).toHaveBeenCalled();
  });
});

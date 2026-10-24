import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeServices } from '../../../../test/fakes';
import { VoiceComposer } from './VoiceComposer';
import { VoicePlayer } from './VoicePlayer';
import { pickMimeType } from './useVoiceRecorder';

const uploadAttachment = vi.hoisted(() => vi.fn());
vi.mock('@/features/chat/upload', () => ({ uploadAttachment }));
vi.mock('../waveform', () => ({ computeWaveform: () => Promise.resolve([10, 80, 40]) }));

/** Stands in for the browser's MediaRecorder: stop() delivers one chunk, then fires onstop. */
class FakeMediaRecorder {
  static supported = ['audio/webm;codecs=opus', 'audio/mp4'];
  static isTypeSupported = (type: string): boolean => FakeMediaRecorder.supported.includes(type);
  static last: FakeMediaRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.last = this;
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice-bytes']) });
    this.onstop?.();
  }
}

const track = { stop: vi.fn() };

beforeEach(() => {
  FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/mp4'];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [track] })) },
  });
  uploadAttachment.mockReset();
  track.stop.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setup = () => {
  const onSend = vi.fn();
  render(
    <div className="relative">
      <VoiceComposer disabled={false} onSend={onSend} />
    </div>,
  );
  return onSend;
};

describe('pickMimeType', () => {
  it('prefers webm/opus and falls back to mp4 on Safari', () => {
    expect(pickMimeType()).toBe('audio/webm;codecs=opus');
    FakeMediaRecorder.supported = ['audio/mp4'];
    expect(pickMimeType()).toBe('audio/mp4');
  });
});

describe('VoiceComposer (recorder state machine)', () => {
  it('idle -> recording -> idle: cancel throws the recording away and frees the microphone', async () => {
    const user = userEvent.setup();
    const onSend = setup();
    await user.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(await screen.findByRole('timer')).toHaveTextContent('0:00');

    await user.click(screen.getByRole('button', { name: 'Cancel recording' }));
    await waitFor(() => {
      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    });
    expect(track.stop).toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('recording -> encoding -> upload -> sends a voice message with duration and waveform', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockResolvedValue('att-voice-1');
    const onSend = setup();
    await user.click(screen.getByRole('button', { name: 'Record voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice message' }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalled();
    });
    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ purpose: 'message', mime: 'audio/webm' }),
    );
    const sent = onSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      type: 'voice',
      attachment_id: 'att-voice-1',
      waveform: [10, 80, 40],
    });
    expect(sent.duration_ms).toBeGreaterThan(0);
    expect(sent).not.toHaveProperty('view_once');
    expect(screen.queryByRole('group', { name: 'Voice message' })).not.toBeInTheDocument();
  });

  it('can send as view once', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockResolvedValue('att-voice-2');
    const onSend = setup();
    await user.click(screen.getByRole('button', { name: 'Record voice message' }));
    await user.click(await screen.findByRole('button', { name: 'View once' }));
    await user.click(screen.getByRole('button', { name: 'Send voice message' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ view_once: true }));
    });
  });

  it('shows a failed upload with Retry, and Retry sends it', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockRejectedValueOnce(new Error('boom')).mockResolvedValue('att-voice-3');
    const onSend = setup();
    await user.click(screen.getByRole('button', { name: 'Record voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Voice message not sent');
    expect(onSend).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
  });

  it('says so when the microphone is blocked', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.reject(new Error('denied'))) },
    });
    setup();
    await user.click(screen.getByRole('button', { name: 'Record voice message' }));
    expect(await screen.findByText(/Microphone not available/)).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('VoicePlayer', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { api } = installFakeServices();
    api.call.mockResolvedValue({
      url: 'https://files.test/voice.webm',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
  });

  it('draws one bar per waveform sample and cycles the playback speed 1x -> 1.5x -> 2x', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VoicePlayer attachmentId="att-play-1" durationMs={65_000} waveform={[5, 50, 100, 30]} />,
    );
    expect(screen.getByTestId('waveform').children).toHaveLength(4);
    expect(screen.getByText('1:05')).toBeInTheDocument();

    const audio = await waitFor(() => {
      const el = container.querySelector('audio');
      expect(el).not.toBeNull();
      return el!;
    });
    const speed = screen.getByRole('button', { name: /Playback speed/ });
    await user.click(speed);
    expect(speed).toHaveTextContent('1.5x');
    expect(audio.playbackRate).toBe(1.5);
    await user.click(speed);
    expect(speed).toHaveTextContent('2x');
    expect(audio.playbackRate).toBe(2);
    await user.click(speed);
    expect(speed).toHaveTextContent('1x');
  });

  it('plays and pauses', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VoicePlayer attachmentId="att-play-2" durationMs={3000} waveform={[10, 20]} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Play voice message' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    act(() => {
      container.querySelector('audio')!.dispatchEvent(new Event('play'));
    });
    expect(screen.getByRole('button', { name: 'Pause voice message' })).toBeInTheDocument();
  });

  it('falls back to a plain bar when there are no samples', () => {
    render(<VoicePlayer attachmentId="att-play-3" durationMs={3000} waveform={[50]} />);
    expect(screen.queryByTestId('waveform')).not.toBeInTheDocument();
  });
});

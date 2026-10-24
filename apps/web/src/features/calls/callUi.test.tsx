// The call screens: the incoming-call dialog and the call overlay, driven through the store.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream, installFakeWebRtc, makeTrack } from '../../../test/webrtcFakes';
import { expectNoA11yViolations } from '../../../test/a11y';
import { installFakeServices } from '../../../test/fakes';
import { CallOverlay } from './components/CallOverlay';
import { IncomingCallModal } from './components/IncomingCallModal';
import { useCallStore } from './useCallStore';

type CallPatch = Partial<ReturnType<typeof useCallStore.getState>>;
const caller = { id: 'u-bob', display_name: 'Bob', avatar_url: null };
const actions = () => ({
  acceptCall: vi.fn(() => Promise.resolve()),
  rejectCall: vi.fn(),
  endCall: vi.fn(),
  toggleMute: vi.fn(),
  toggleCamera: vi.fn(),
  startScreenShare: vi.fn(() => Promise.resolve()),
  stopScreenShare: vi.fn(() => Promise.resolve()),
  clearFailure: vi.fn(),
  loadDevices: vi.fn(() => Promise.resolve()),
  setAudioInput: vi.fn(() => Promise.resolve()),
  setAudioOutput: vi.fn(),
  setVideoInput: vi.fn(() => Promise.resolve()),
});
let fns: ReturnType<typeof actions>;

const setCall = (state: CallPatch) => {
  act(() => {
    useCallStore.setState(state);
  });
};

beforeEach(() => {
  installFakeWebRtc();
  installFakeServices();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  fns = actions();
  useCallStore.getState()._cleanup();
  useCallStore.getState().clearFailure();
  useCallStore.setState({ ...fns });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('incoming call dialog', () => {
  const ringing = (callType: 'audio' | 'video' = 'video') =>
    setCall({ callStatus: 'ringing', callType, otherUser: caller, callId: 'c1', isCaller: false });

  it('is not there when nothing is ringing', () => {
    render(<IncomingCallModal />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it.each([
    ['video', 'Incoming video call…', 'Video'],
    ['audio', 'Incoming voice call…', 'Voice'],
  ] as const)('shows the caller and the %s kind', (type, line, chip) => {
    render(<IncomingCallModal />);
    ringing(type);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(within(dialog).getByText(line)).toBeInTheDocument();
    expect(within(dialog).getByText(chip)).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName('Bob');
    expect(dialog).toHaveAccessibleDescription(line);
  });

  it('puts focus on Accept so Enter answers', () => {
    render(<IncomingCallModal />);
    ringing();
    expect(screen.getByRole('button', { name: 'Accept call' })).toHaveFocus();
  });

  it('Accept and Decline call the store', async () => {
    const user = userEvent.setup();
    render(<IncomingCallModal />);
    ringing();
    await user.click(screen.getByRole('button', { name: 'Accept call' }));
    expect(fns.acceptCall).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Decline call' }));
    expect(fns.rejectCall).toHaveBeenCalledTimes(1);
  });

  it('Escape declines, a click outside does not', async () => {
    const user = userEvent.setup();
    render(<IncomingCallModal />);
    ringing();
    await user.click(screen.getByRole('alertdialog').parentElement!); // the backdrop
    expect(fns.rejectCall).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Accept call' }).focus();
    await user.keyboard('{Escape}');
    expect(fns.rejectCall).toHaveBeenCalledTimes(1);
  });

  it('disappears when the call stops ringing (answered elsewhere, caller hung up)', () => {
    render(<IncomingCallModal />);
    ringing();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    setCall({ callStatus: 'idle' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    render(<IncomingCallModal />);
    ringing();
    await expectNoA11yViolations();
  });
});

describe('call overlay', () => {
  const inCall = (over: CallPatch = {}) =>
    setCall({
      callStatus: 'connected',
      connectionState: 'connected',
      callType: 'video',
      otherUser: caller,
      callId: 'c1',
      localStream: new FakeStream([makeTrack('audio'), makeTrack('video')]) as never,
      ...over,
    });

  it('shows nothing while idle', () => {
    const { container } = render(<CallOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['calling', 'new', 'Calling…'],
    ['connected', 'new', 'Connecting…'],
    ['connected', 'connecting', 'Connecting…'],
    ['connected', 'connected', 'Connected'],
    ['connected', 'reconnecting', 'Reconnecting…'],
  ] as const)('status %s/%s reads "%s"', (callStatus, connectionState, label) => {
    render(<CallOverlay />);
    inCall({ callStatus, connectionState });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(`Bob · ${label}`);
  });

  it('names the dialog by kind and person', () => {
    render(<CallOverlay />);
    inCall({ callType: 'audio' });
    expect(screen.getByRole('dialog', { name: 'Voice call with Bob' })).toBeInTheDocument();
    inCall({ callType: 'video' });
    expect(screen.getByRole('dialog', { name: 'Video call with Bob' })).toBeInTheDocument();
  });

  describe('video call', () => {
    it('shows my camera preview and, until video arrives, the caller placeholder', () => {
      const { container } = render(<CallOverlay />);
      inCall();
      expect(screen.getByLabelText('Your camera')).toBeInTheDocument();
      expect(container.querySelectorAll('video')).toHaveLength(2);
      expect(screen.getAllByText('Bob').length).toBeGreaterThan(0); // placeholder name
    });

    it('hides the placeholder once live remote video is flowing', () => {
      render(<CallOverlay />);
      const remote = new FakeStream([makeTrack('audio'), makeTrack('video')]);
      inCall({ remoteStream: remote as never });
      expect(screen.queryByText('Connected', { selector: 'p' })).not.toBeInTheDocument();
    });

    it('camera off replaces the preview with an icon', () => {
      render(<CallOverlay />);
      inCall({ isCameraOff: true });
      expect(screen.queryByLabelText('Your camera')).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Your camera is off' })).toBeInTheDocument();
    });

    it('while sharing, the preview shows the screen and a "Stop sharing" bar appears', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall({
        isSharing: true,
        isCameraOff: true,
        screenStream: new FakeStream([makeTrack('video')]) as never,
      });
      expect(screen.getByLabelText('Your camera')).toBeInTheDocument();
      expect(screen.getByText('You are sharing your screen')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
      expect(fns.stopScreenShare).toHaveBeenCalled();
    });
  });

  describe('voice call', () => {
    it('has no video elements and no camera or share buttons', () => {
      const { container } = render(<CallOverlay />);
      inCall({ callType: 'audio' });
      expect(container.querySelector('video')).toBeNull();
      expect(screen.queryByRole('button', { name: /camera/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
    });
  });

  describe('controls', () => {
    it('each button calls its own action', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall();
      await user.click(screen.getByRole('button', { name: 'Mute' }));
      expect(fns.toggleMute).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'Turn camera off' }));
      expect(fns.toggleCamera).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'End call' }));
      expect(fns.endCall).toHaveBeenCalledTimes(1);
    });

    it('mute and camera show their state with aria-pressed and a changed label', () => {
      render(<CallOverlay />);
      inCall({ isMuted: true, isCameraOff: true });
      expect(screen.getByRole('button', { name: 'Unmute' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Turn camera on' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('Share screen shows only for a connected video call, and starts/stops sharing', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall({ callStatus: 'calling', connectionState: 'new' });
      expect(screen.queryByRole('button', { name: 'Share screen' })).not.toBeInTheDocument();
      inCall();
      await user.click(screen.getByRole('button', { name: 'Share screen' }));
      expect(fns.startScreenShare).toHaveBeenCalledTimes(1);
      inCall({ isSharing: true, screenStream: new FakeStream([makeTrack('video')]) as never });
      await user.click(screen.getByRole('button', { name: 'Stop sharing screen' }));
      expect(fns.stopScreenShare).toHaveBeenCalled();
    });

    it('Share screen is missing where the browser cannot share (most phones)', () => {
      const real = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: real.getUserMedia },
      });
      render(<CallOverlay />);
      inCall();
      expect(screen.queryByRole('button', { name: 'Share screen' })).not.toBeInTheDocument();
    });
  });

  describe('device panel', () => {
    const device = (kind: MediaDeviceKind, id: string, label: string) =>
      ({ kind, deviceId: id, label }) as MediaDeviceInfo;

    it('opens on demand, loads devices and lists microphone, camera (video only) and speaker', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall({
        devices: {
          mics: [device('audioinput', 'm1', 'Built-in mic'), device('audioinput', 'm2', 'USB mic')],
          cameras: [device('videoinput', 'c1', 'FaceTime')],
          speakers: [],
        },
        audioInputId: 'm1',
      });
      expect(
        screen.queryByRole('group', { name: 'Audio and video devices' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Audio & video settings' }));
      expect(fns.loadDevices).toHaveBeenCalled();
      const panel = screen.getByRole('group', { name: 'Audio and video devices' });
      expect(within(panel).getByLabelText('Microphone')).toHaveValue('m1');
      expect(within(panel).getByLabelText('Camera')).toBeInTheDocument();
      await user.selectOptions(within(panel).getByLabelText('Microphone'), 'm2');
      expect(fns.setAudioInput).toHaveBeenCalledWith('m2');
      await user.click(screen.getByRole('button', { name: 'Audio & video settings' }));
      expect(
        screen.queryByRole('group', { name: 'Audio and video devices' }),
      ).not.toBeInTheDocument();
    });

    it('a voice call has no camera picker', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall({ callType: 'audio' });
      await user.click(screen.getByRole('button', { name: 'Audio & video settings' }));
      expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
    });

    it('closes by itself when the call ends', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall();
      await user.click(screen.getByRole('button', { name: 'Audio & video settings' }));
      setCall({ callStatus: 'idle' });
      inCall();
      expect(
        screen.queryByRole('group', { name: 'Audio and video devices' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('failure message', () => {
    it('shows after the overlay closes, and Dismiss clears it', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      setCall({ failure: 'Bob is offline right now.' });
      expect(screen.getByRole('alert')).toHaveTextContent('Bob is offline right now.');
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(fns.clearFailure).toHaveBeenCalled();
    });
  });

  describe('remote audio', () => {
    it('is always mounted for a connected call (the video element stays muted)', () => {
      const { container } = render(<CallOverlay />);
      inCall({ remoteStream: new FakeStream([makeTrack('audio')]) as never });
      expect(container.querySelector('audio')).not.toBeNull();
      for (const video of container.querySelectorAll('video')) expect(video.muted).toBe(true);
    });

    it('a click anywhere retries playback that the browser blocked', async () => {
      const user = userEvent.setup();
      render(<CallOverlay />);
      inCall({ remoteStream: new FakeStream([makeTrack('audio')]) as never });
      const play = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
      play.mockClear();
      await user.click(document.body);
      expect(play).toHaveBeenCalled();
    });
  });

  it.each([
    ['video call', { callType: 'video' as const }],
    ['voice call', { callType: 'audio' as const }],
    ['calling', { callStatus: 'calling' as const, connectionState: 'new' as const }],
  ])('has no accessibility violations (%s)', async (_n, over) => {
    render(<CallOverlay />);
    inCall(over);
    await expectNoA11yViolations();
  });
});

// Each setting has to change something you can see or hear. These tests check the "something".
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubNavigator } from '../../../test/stubNavigator';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import {
  BOB,
  CONV,
  ME,
  fakeApi,
  installFakeServices,
  makeConversation,
  makeMessage,
} from '../../../test/fakes';
import { startRingtone } from '../calls/ringtone';
import { getLocalMedia, limitVideoBitrate } from '../calls/media';
import { renderContent } from '../chat/content/registry';
import { useSessionStore } from '../auth/useSessionStore';
import { MessageInput } from '../chat/components/MessageInput';
import * as outbox from '../chat/outbox/useOutboxStore';
import { useChatStore } from '../chat/useChatStore';
import { ModelTag } from '../ai/ModelTag';
import { notifyIncoming } from '../notifications/notifyIncoming';
import * as sound from '../notifications/sound';
import { useDraftStore } from '../organise/drafts';
import { applyDefaultTimer } from './newChatDefaults';
import { useSettingsStore } from './useSettingsStore';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const set = (patch: Parameters<ReturnType<typeof useSettingsStore.getState>['update']>[0]) => {
  useSettingsStore.getState().update(patch);
};

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  removeFakePush();
});

// ------------------------------------------------------------- media auto-download

describe('media auto-download', () => {
  let n = 0;
  const image = () => {
    n += 1;
    return renderContent(
      { type: 'image', attachment_id: `att-${String(n)}`, width: 100, height: 80 } as never,
      { onOpenImage: vi.fn() },
    );
  };
  const connection = (value: object | undefined) => {
    Object.defineProperty(navigator, 'connection', { value, configurable: true });
  };
  const setup = () => {
    const api = fakeApi();
    api.call.mockResolvedValue({ url: 'https://files/x.jpg', expires_at: '2099-01-01T00:00:00Z' });
    installFakeServices(undefined, api);
    return api;
  };
  afterEach(() => {
    connection(undefined);
  });

  it('"Always" loads the photo', async () => {
    const api = setup();
    render(<>{image()}</>);
    expect(await screen.findByRole('img', { name: 'Image' })).toHaveAttribute(
      'src',
      'https://files/x.jpg',
    );
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.media.download, expect.anything());
  });

  it('"Never" shows a button and fetches nothing until it is tapped', async () => {
    set({ mediaAutoDownload: 'never' });
    const api = setup();
    render(<>{image()}</>);
    const button = screen.getByRole('button', { name: /Download photo/ });
    expect(api.call).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(await screen.findByRole('img', { name: 'Image' })).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledTimes(1);
  });

  it('"Wi-Fi only" uses navigator.connection: waits on mobile data, loads on Wi-Fi', async () => {
    set({ mediaAutoDownload: 'wifi' });
    connection({ type: 'cellular' });
    const api = setup();
    const first = render(<>{image()}</>);
    expect(screen.getByRole('button', { name: /Download photo/ })).toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalled();
    first.unmount();

    connection({ type: 'wifi' });
    render(<>{image()}</>);
    expect(await screen.findByRole('img', { name: 'Image' })).toBeInTheDocument();
  });

  it('videos and voice messages wait too', () => {
    set({ mediaAutoDownload: 'never' });
    setup();
    const video = render(
      <>
        {renderContent(
          { type: 'video', attachment_id: 'vid', width: 4, height: 3, duration_ms: 1000 } as never,
          { onOpenImage: vi.fn() },
        )}
      </>,
    );
    expect(screen.getByRole('button', { name: /Download video/ })).toBeInTheDocument();
    video.unmount();
    render(
      <>
        {renderContent(
          { type: 'voice', attachment_id: 'vo', duration_ms: 3000, waveform: [] } as never,
          { onOpenImage: vi.fn() },
        )}
      </>,
    );
    expect(screen.getByRole('button', { name: /Download voice message/ })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- link previews

describe('link previews', () => {
  const text = (url: string) =>
    renderContent({ type: 'text', text: `see ${url}` } as never, { onOpenImage: vi.fn() });

  it('are fetched only while the setting is on', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue({
      url: 'https://example.com/a',
      title: 'Example title',
      description: 'd',
      image_url: null,
      site_name: null,
    });
    installFakeServices(undefined, api);
    set({ linkPreviews: false });
    const off = render(<>{text('https://example.com/off')}</>);
    expect(api.call).not.toHaveBeenCalled();
    off.unmount();

    set({ linkPreviews: true });
    render(<>{text('https://example.com/on')}</>);
    expect(await screen.findByLabelText(/Link preview/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- composer

describe('Enter sends', () => {
  const setup = () => {
    installFakeServices();
    useChatStore.getState().reset();
    useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
    useDraftStore.setState({ drafts: {} });
    const send = vi.spyOn(outbox, 'sendMessage').mockReturnValue('id');
    render(<MessageInput conversation={makeConversation()} messages={[]} />);
    return { send, input: screen.getByLabelText(/Message Bob/), user: userEvent.setup() };
  };

  it('on: Enter sends', async () => {
    const { send, input, user } = setup();
    await user.type(input, 'hello{Enter}');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('off: Enter does not send, Ctrl+Enter and Cmd+Enter do', async () => {
    set({ enterSends: false });
    const { send, input, user } = setup();
    await user.type(input, 'hello{Enter}');
    expect(send).not.toHaveBeenCalled();
    expect(input).toHaveValue('hello');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(send).toHaveBeenCalledTimes(1);

    await user.type(input, 'again');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('typing indicator', () => {
  it('off: nothing is sent while typing, and others typing is not shown', () => {
    const { transport } = installFakeServices();
    set({ showTyping: false });
    useChatStore.getState().notifyTyping(CONV);
    expect(transport.sentOf('typing_start')).toHaveLength(0);
    useChatStore.getState().setActivity(CONV, BOB, 'typing');
    expect(useChatStore.getState().typing[CONV]?.[BOB]).toBeUndefined();
  });

  it('on: both work', () => {
    const { transport } = installFakeServices();
    useChatStore.getState().notifyTyping(CONV);
    expect(transport.sentOf('typing_start')).toHaveLength(1);
    useChatStore.getState().setActivity(CONV, BOB, 'typing');
    expect(useChatStore.getState().typing[CONV]?.[BOB]).toBe('typing');
    useChatStore.getState().setActivity(CONV, BOB, null);
  });
});

describe('drafts', () => {
  it('are kept in storage only while "Keep drafts" is on', () => {
    useDraftStore.setState({ drafts: {} });
    useDraftStore.getState().setDraft('c1', 'one');
    expect(localStorage.getItem('flick:drafts')).toContain('one');
    set({ saveDrafts: false });
    useDraftStore.getState().setDraft('c2', 'two');
    expect(localStorage.getItem('flick:drafts')).toBeNull();
    expect(useDraftStore.getState().drafts.c2).toBe('two'); // still there for this page
  });
});

// ------------------------------------------------------------- notifications

describe('notifyIncoming settings', () => {
  const summary = (extra: object = {}) =>
    ({
      id: CONV,
      type: 'direct',
      title: null,
      prefs: { muted_until: null, archived: false },
      ...extra,
    }) as ConversationSummary;
  const live = () =>
    makeMessage({
      sender_user_id: BOB,
      created_at: new Date().toISOString(),
      content: { type: 'text', text: 'secret plans' },
    });
  const ctx = (s = summary()) => ({ summary: s, myId: ME, senderName: 'Bob', open: vi.fn() });
  const hidden = () => vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const clock = (offsetMin: number) => {
    const d = new Date(Date.now() + offsetMin * 60_000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  it('plays the sound at the chosen volume, and not when the sound is off', () => {
    const play = vi.spyOn(sound, 'playMessageSound').mockReturnValue(true);
    hidden();
    set({ soundVolume: 0.25 });
    notifyIncoming(live(), ctx());
    expect(play).toHaveBeenCalledWith(0.25);
    play.mockClear();
    set({ messageSound: false });
    notifyIncoming(live(), ctx());
    expect(play).not.toHaveBeenCalled();
  });

  it('vibrates when vibration is on', () => {
    const vibrate = vi.fn();
    stubNavigator({ vibrate });
    vi.spyOn(sound, 'playMessageSound').mockReturnValue(true);
    hidden();
    notifyIncoming(live(), ctx());
    expect(vibrate).toHaveBeenCalledWith(200);
    vibrate.mockClear();
    set({ vibration: false });
    notifyIncoming(live(), ctx());
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('shows only "New message" when previews are off', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    vi.spyOn(sound, 'playMessageSound').mockReturnValue(true);
    hidden();
    notifyIncoming(live(), ctx());
    expect(FakeNotification.created[0]?.options?.body).toBe('secret plans');
    set({ messagePreviews: false });
    notifyIncoming(live(), ctx());
    expect(FakeNotification.created[1]?.options?.body).toBe('New message');
  });

  it('quiet hours silence the sound and the notification, and end afterwards', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    const play = vi.spyOn(sound, 'playMessageSound').mockReturnValue(true);
    hidden();
    set({ quietHoursOn: true, quietFrom: clock(-60), quietTo: clock(60) });
    notifyIncoming(live(), ctx());
    expect(play).not.toHaveBeenCalled();
    expect(FakeNotification.created).toHaveLength(0);

    set({ quietFrom: clock(60), quietTo: clock(120) }); // later today
    notifyIncoming(live(), ctx());
    expect(play).toHaveBeenCalled();
    expect(FakeNotification.created).toHaveLength(1);
  });

  it('"Keep archived" off takes an archived chat out of the archive on a new message', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue({ archived: false });
    installFakeServices(undefined, api);
    const archived = summary({ prefs: { muted_until: null, archived: true } });
    notifyIncoming(live(), ctx(archived));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.call).not.toHaveBeenCalled(); // default: it stays archived

    set({ keepArchived: false });
    notifyIncoming(live(), ctx(archived));
    await waitFor(() => {
      expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.updatePrefs, {
        params: { conversation_id: CONV },
        body: { archived: false },
      });
    });
  });
});

// ------------------------------------------------------------- new chats

describe('default disappearing timer', () => {
  const fresh = (extra: object = {}) =>
    makeConversation({ id: CONV, last_message: null, ...extra });

  it('is set on a new, empty chat', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue(fresh());
    installFakeServices(undefined, api);
    set({ defaultDisappearing: 86_400 });
    await applyDefaultTimer(fresh());
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.update, {
      params: { conversation_id: CONV },
      body: { settings: { disappearing_timer_s: 86_400 } },
    });
  });

  it('is not set when it is off, or when the chat already has messages', async () => {
    const api = fakeApi();
    installFakeServices(undefined, api);
    await applyDefaultTimer(fresh());
    set({ defaultDisappearing: 86_400 });
    await applyDefaultTimer(fresh({ last_message: makeMessage() }));
    expect(api.call).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- AI

describe('model name', () => {
  it('shows under an AI answer and hides when the setting is off', () => {
    const { rerender } = render(<ModelTag label="Anthropic · claude" />);
    expect(screen.getByText(/Answered by Anthropic/)).toBeInTheDocument();
    act(() => {
      set({ showModelName: false });
    });
    rerender(<ModelTag label="Anthropic · claude" />);
    expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------- calls

describe('call settings', () => {
  it('the microphone constraints follow noise suppression and echo cancellation', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({});
    stubNavigator({ mediaDevices: { getUserMedia } });
    await getLocalMedia('audio', { noiseSuppression: false, echoCancellation: true });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { noiseSuppression: false, echoCancellation: true },
      video: false,
    });
    await getLocalMedia('video');
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: { noiseSuppression: true, echoCancellation: true },
      video: true,
    });
  });

  it('the video bitrate limit is passed in, and only video senders get it', async () => {
    const params = { encodings: [{}] as { maxBitrate?: number }[] };
    const setParameters = vi.fn().mockResolvedValue(undefined);
    const video = { track: { kind: 'video' }, getParameters: () => params, setParameters };
    const audio = { track: { kind: 'audio' }, getParameters: vi.fn(), setParameters: vi.fn() };
    await limitVideoBitrate({ getSenders: () => [audio, video] as never }, 400_000);
    expect(setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 400_000 }] });
    expect(audio.setParameters).not.toHaveBeenCalled();
  });

  it('a browser that refuses the limit does not break the call', async () => {
    const video = {
      track: { kind: 'video' },
      getParameters: () => ({}),
      setParameters: () => Promise.reject(new Error('InvalidModificationError')),
    };
    await expect(
      limitVideoBitrate({ getSenders: () => [video] as never }, 1_200_000),
    ).resolves.toBeUndefined();
  });
});

describe('ringtone', () => {
  const audio = () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const started: number[] = [];
    class Ctx {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator = () => ({
        frequency: { value: 0 },
        connect: (n: unknown) => n,
        start: (t: number) => started.push(t),
        stop: vi.fn(),
      });
      createGain = () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: (n: unknown) => n,
      });
      close = close;
    }
    vi.stubGlobal('AudioContext', Ctx);
    return { started, close };
  };

  it('does nothing when switched off or silent', () => {
    const { started } = audio();
    startRingtone({ enabled: false, volume: 0.5 })();
    startRingtone({ enabled: true, volume: 0 })();
    expect(started).toHaveLength(0);
  });

  it('rings, keeps ringing, and stops', () => {
    vi.useFakeTimers();
    const { started, close } = audio();
    const stop = startRingtone({ enabled: true, volume: 0.5 });
    expect(started).toHaveLength(2);
    vi.advanceTimersByTime(2_000);
    expect(started).toHaveLength(4);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(started).toHaveLength(4);
    expect(close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

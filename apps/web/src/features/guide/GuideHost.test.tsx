// The host decides who is taken on the tour, who is only offered it, and when a tip may speak.
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  BOB,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  type FakeApi,
} from '../../../test/fakes';
import { GuideHost } from './GuideHost';
import { disableGuideForTests, enableGuideForTests } from './testing';
import { useGuideStore } from './useGuideStore';
import { WelcomeCard } from './WelcomeCard';

const serverState = {
  seen: {},
  used: {},
  welcome_done_at: null,
  enabled: true,
  version: 0,
};
const store = () => useGuideStore.getState();

const signIn = (createdAt: string) => {
  useSessionStore.setState({
    user: { id: ME, created_at: createdAt } as never,
    status: 'authenticated',
  });
};
const listReady = (conversations = {}) => {
  useChatStore.setState({ conversations, listStatus: 'ready', selectedId: null });
};
const mount = () =>
  render(
    <MemoryRouter>
      <GuideHost />
      <WelcomeCard />
    </MemoryRouter>,
  );
/** Let the host's heartbeat run (in slices, so what one slice starts the next can see). */
const beat = async (ms = 1800) => {
  for (let spent = 0; spent < ms; spent += 600) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(600, ms - spent));
    });
  }
};

let api: FakeApi;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(new Date('2026-03-01T09:00:00.000Z'));
  ({ api } = installFakeServices());
  api.call.mockResolvedValue(serverState);
  enableGuideForTests(null);
  useChatStore.getState().reset();
  useCallStore.setState({ callStatus: 'idle' });
});
afterEach(() => {
  disableGuideForTests();
  useSessionStore.setState({ user: null, status: 'booting' });
  vi.useRealTimers();
});

describe('guide host', () => {
  it('takes a brand new person on the welcome tour by itself', async () => {
    signIn('2026-03-01T08:55:00.000Z');
    listReady();
    mount();
    await beat();
    expect(screen.getByRole('dialog', { name: 'Your chats live here' })).toBeInTheDocument();
    expect(store().active?.source).toBe('welcome');
  });

  it('waits for the chat list before starting', async () => {
    signIn('2026-03-01T08:55:00.000Z');
    useChatStore.setState({ listStatus: 'loading' });
    mount();
    await beat();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    useChatStore.setState({ listStatus: 'ready' });
    await beat();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not start the tour again once it was finished or skipped', async () => {
    signIn('2026-03-01T08:55:00.000Z');
    listReady();
    api.call.mockResolvedValue({ ...serverState, welcome_done_at: '2026-02-01T10:00:00.000Z' });
    mount();
    await beat();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('only offers the tour to an existing user (a card, never forced)', async () => {
    signIn('2025-01-01T08:00:00.000Z');
    listReady({
      c1: makeConversation({
        id: 'c1',
        last_message: makeMessage({ sender_user_id: BOB }),
      }),
    });
    mount();
    await beat();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Tour of Flick' });
    expect(card).toHaveTextContent('New here?');
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeInTheDocument();
  });

  it('"Not now" hides the offer for good', async () => {
    signIn('2025-01-01T08:00:00.000Z');
    listReady({
      c1: makeConversation({ id: 'c1', last_message: makeMessage() }),
    });
    mount();
    await beat();
    await act(async () => {
      screen.getByRole('button', { name: 'Not now' }).click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByRole('region', { name: 'Tour of Flick' })).not.toBeInTheDocument();
    expect(store().seen).toHaveProperty('welcome.card');
  });

  it('offers "Resume tour" after the tour was closed halfway', async () => {
    signIn('2026-03-01T08:55:00.000Z');
    listReady();
    mount();
    await beat();
    act(() => {
      store().next();
      store().next();
      store().close();
    });
    await beat();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Resume tour' }).click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(store().active?.step).toBe(2);
  });

  it('shows a queued tip to an existing user, but not while a dialog is open', async () => {
    signIn('2025-01-01T08:00:00.000Z');
    listReady({ c1: makeConversation({ id: 'c1', last_message: makeMessage() }) });
    api.call.mockResolvedValue({ ...serverState, welcome_done_at: '2025-02-01T10:00:00.000Z' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    mount();
    await beat();
    act(() => {
      store().requestTip('composer.gif');
    });
    await beat();
    expect(store().active).toBeNull();
    dialog.remove();
    await beat();
    expect(store().active?.topicId).toBe('composer.gif');
  });

  it('is silent during a call, and the tour comes back after it', async () => {
    signIn('2026-03-01T08:55:00.000Z');
    listReady();
    mount();
    await beat();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      useCallStore.setState({ callStatus: 'connected' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      useCallStore.setState({ callStatus: 'idle' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a tip is dropped when a call starts, and nothing new starts during it', async () => {
    signIn('2025-01-01T08:00:00.000Z');
    listReady({ c1: makeConversation({ id: 'c1', last_message: makeMessage() }) });
    api.call.mockResolvedValue({ ...serverState, welcome_done_at: '2025-02-01T10:00:00.000Z' });
    mount();
    await beat();
    act(() => {
      store().requestTip('composer.gif');
    });
    await beat();
    expect(store().active?.topicId).toBe('composer.gif');
    act(() => {
      useCallStore.setState({ callStatus: 'ringing' });
    });
    await beat();
    expect(store().active).toBeNull();
    act(() => {
      store().requestTip('composer.poll');
    });
    await beat(61_000);
    expect(store().active).toBeNull();
  });

  it('does not show the person features they have clearly used already', async () => {
    signIn('2025-01-01T08:00:00.000Z');
    listReady({
      g: makeConversation({
        id: 'g',
        type: 'group',
        last_message: makeMessage({ sender_user_id: ME }),
      }),
    });
    mount();
    await beat();
    expect(store().used).toHaveProperty('group.create');
    expect(store().used).toHaveProperty('composer.basics');
  });
});

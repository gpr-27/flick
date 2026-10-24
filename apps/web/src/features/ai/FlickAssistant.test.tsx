import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLICK_BOT_USER_ID } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { BOB, ME, installFakeServices, makeConversation, makeMessage } from '../../../test/fakes';
import { Sidebar } from '../chat/components/Sidebar';
import { sortConversations } from '../chat/threadOps';
import { useChatStore } from '../chat/useChatStore';
import { EXAMPLE_PROMPTS } from './examplePrompts';
import { FlickAvatar, FlickBadge } from './FlickBadge';
import { FlickThinking } from './FlickThinking';
import { FlickWelcome } from './FlickWelcome';
import { isFlickChat } from './isFlickBot';
import { THINKING_MS, pendingFlickMessage, useFlickThinking } from './useFlickThinking';

const bot = {
  id: FLICK_BOT_USER_ID,
  username: 'flick',
  display_name: 'Flick',
  avatar_url: null,
  is_bot: true,
};
const botChat = (overrides = {}) => makeConversation({ peer: bot, ...overrides });
const group = () => makeConversation({ type: 'group', peer: null, member_count: 3 });
const mine = (text: string, extra = {}) =>
  makeMessage({ sender_user_id: ME, content: { type: 'text', text }, ...extra });
const fromBot = () =>
  makeMessage({ sender_user_id: FLICK_BOT_USER_ID, content: { type: 'text', text: 'hi' } });

describe('FlickBadge and FlickAvatar', () => {
  it('shows an accessible AI badge', () => {
    render(<FlickBadge />);
    expect(screen.getByRole('img', { name: 'Flick AI assistant' })).toHaveTextContent('AI');
  });

  it('draws the gradient avatar at every size', () => {
    render(<FlickAvatar size="xs" />);
    expect(screen.getByRole('img', { name: 'Flick' })).toHaveClass('bg-gradient-to-br', 'size-8');
  });
});

describe('the Flick chat in the list', () => {
  beforeEach(() => {
    installFakeServices();
    useChatStore.getState().reset();
    useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  });

  it('recognises the bot chat', () => {
    expect(isFlickChat(botChat())).toBe(true);
    expect(isFlickChat(makeConversation())).toBe(false);
    expect(isFlickChat(group())).toBe(false);
  });

  it('sorts first even when other chats are newer or pinned', () => {
    const newer = makeConversation({ id: 'c1', created_at: '2026-06-01T00:00:00.000Z' });
    const pinned = makeConversation({
      id: 'c2',
      prefs: { ...makeConversation().prefs, pinned: true },
    });
    const flick = botChat({ id: 'c3', created_at: '2020-01-01T00:00:00.000Z' });
    expect(sortConversations([newer, pinned, flick]).map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('shows the avatar and AI badge in the chat list', () => {
    const flick = botChat();
    useChatStore.setState({ listStatus: 'ready', conversations: { [flick.id]: flick } });
    render(<Sidebar />);
    expect(screen.getByRole('img', { name: 'Flick' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Flick AI assistant' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pinned' })).toBeInTheDocument();
  });
});

describe('example prompts', () => {
  it('offers four tappable prompts that are sent as written', async () => {
    const onPick = vi.fn();
    render(<FlickWelcome onPick={onPick} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: EXAMPLE_PROMPTS[1] }));
    expect(onPick).toHaveBeenCalledWith(EXAMPLE_PROMPTS[1]);
  });
});

describe('thinking indicator', () => {
  it('is a polite live region with the text', () => {
    render(<FlickThinking />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Flick is thinking…');
  });

  it('waits in the bot chat after any message of mine, until the bot answers', () => {
    const m = mine('hello');
    expect(pendingFlickMessage([m], ME, botChat())).toBe(m);
    expect(pendingFlickMessage([m, fromBot()], ME, botChat())).toBeNull();
    expect(pendingFlickMessage([], ME, botChat())).toBeNull();
  });

  it('waits in a group only after an @flick mention or a reply to the bot', () => {
    expect(pendingFlickMessage([mine('lunch?')], ME, group())).toBeNull();
    expect(pendingFlickMessage([mine('hey @bob')], ME, group())).toBeNull();
    const ask = mine('@Flick what is 2+2');
    expect(pendingFlickMessage([ask], ME, group())).toBe(ask);
    const answer = fromBot();
    const reply = mine('and 3+3?', {
      content: { type: 'text', text: 'and 3+3?', reply_to: answer.message_id },
    });
    expect(pendingFlickMessage([answer, reply], ME, group())).toBe(reply);
    // someone else talking after my question does not cancel the wait
    expect(pendingFlickMessage([ask, makeMessage({ sender_user_id: BOB })], ME, group())).toBe(ask);
  });

  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows for a fresh message and stops after about 40 seconds', () => {
      const m = mine('hello', { created_at: new Date().toISOString() });
      const { result } = renderHook(() => useFlickThinking([m], ME, botChat()));
      expect(result.current).toBe(true);
      act(() => {
        vi.advanceTimersByTime(THINKING_MS + 100);
      });
      expect(result.current).toBe(false);
    });

    it('does not show for an old unanswered message on open', () => {
      const m = mine('hello', { created_at: new Date(Date.now() - 5 * 60_000).toISOString() });
      const { result } = renderHook(() => useFlickThinking([m], ME, botChat()));
      expect(result.current).toBe(false);
    });

    it('hides as soon as the bot message arrives', () => {
      const m = mine('hello', { created_at: new Date().toISOString() });
      const { result, rerender } = renderHook(({ list }) => useFlickThinking(list, ME, botChat()), {
        initialProps: { list: [m] },
      });
      expect(result.current).toBe(true);
      rerender({ list: [m, fromBot()] });
      expect(result.current).toBe(false);
    });
  });
});

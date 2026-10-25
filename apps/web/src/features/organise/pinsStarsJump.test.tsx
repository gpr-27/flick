// Pins, stars, the starred panel and "jump to a message".
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS } from '@chat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { useChatStore } from '../chat/useChatStore';
import {
  CONV,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../test/fakes';
import { useJumpEffect, useJumpStore } from './jump';
import { toggleStar, usePinsStore } from './messageActions';
import { StarredPanel } from './StarredPanel';

let api: FakeApi;

beforeEach(() => {
  ({ api } = installFakeServices());
  useChatStore.getState().reset();
  usePinsStore.setState({ byConversation: {} });
  useJumpStore.setState({ target: null, flashId: null });
  vi.spyOn(notify, 'error').mockImplementation(() => '');
  vi.spyOn(notify, 'info').mockImplementation(() => '');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pins', () => {
  it('load stores the server order; a failure is silent and leaves the old pins', async () => {
    const a = makeMessage({ seq: 2 });
    api.call.mockResolvedValueOnce({ items: [a] });
    await usePinsStore.getState().load(CONV);
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([a]);
    api.call.mockRejectedValueOnce(new Error('x'));
    await usePinsStore.getState().load(CONV);
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([a]);
  });

  it('pinning calls pin with the message id, then reloads', async () => {
    const m = makeMessage({ seq: 2 });
    api.call.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ items: [m] });
    await usePinsStore.getState().toggle(m);
    expect(api.call).toHaveBeenNthCalledWith(1, ENDPOINTS.messages.pin, {
      params: { conversation_id: CONV },
      body: { message_id: m.message_id },
    });
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([m]);
  });

  it('a pin from another member reloads the list, so the pinned bar updates live', async () => {
    const old = makeMessage({ seq: 2 });
    const fresh = makeMessage({ seq: 3 });
    usePinsStore.setState({ byConversation: { [CONV]: [old] } });
    api.call.mockResolvedValueOnce({ items: [fresh, old] });
    usePinsStore
      .getState()
      .applyChange({ conversation_id: CONV, message_id: fresh.message_id, pinned: true });
    await waitFor(() => {
      expect(usePinsStore.getState().byConversation[CONV]).toEqual([fresh, old]);
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.pins, {
      params: { conversation_id: CONV },
    });
  });

  it('an unpin from another member drops the message at once, without a request', () => {
    const a = makeMessage({ seq: 2 });
    const b = makeMessage({ seq: 3 });
    usePinsStore.setState({ byConversation: { [CONV]: [b, a] } });
    usePinsStore
      .getState()
      .applyChange({ conversation_id: CONV, message_id: b.message_id, pinned: false });
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([a]);
    expect(api.call).not.toHaveBeenCalled();
  });

  it('a pin in a chat whose pins were never loaded is left for when the chat opens', () => {
    usePinsStore
      .getState()
      .applyChange({ conversation_id: CONV, message_id: nextId(), pinned: true });
    expect(api.call).not.toHaveBeenCalled();
    expect(usePinsStore.getState().byConversation[CONV]).toBeUndefined();
  });

  it('toggling a pinned message unpins it, then reloads', async () => {
    const m = makeMessage({ seq: 2 });
    usePinsStore.setState({ byConversation: { [CONV]: [m] } });
    api.call.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ items: [] });
    await usePinsStore.getState().toggle(m);
    expect(api.call).toHaveBeenNthCalledWith(1, ENDPOINTS.messages.unpin, {
      params: { conversation_id: CONV, message_id: m.message_id },
    });
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([]);
  });

  it.each([
    ['pin', [], "Couldn't pin."],
    ['unpin', 'pinned', "Couldn't unpin."],
  ])('%s failure shows a message and changes nothing', async (_name, start, message) => {
    const m = makeMessage({ seq: 2 });
    usePinsStore.setState({ byConversation: { [CONV]: start === 'pinned' ? [m] : [] } });
    api.call.mockRejectedValueOnce(new Error('x'));
    await usePinsStore.getState().toggle(m);
    expect(notify.error).toHaveBeenCalledWith(message);
    expect(usePinsStore.getState().byConversation[CONV]).toHaveLength(start === 'pinned' ? 1 : 0);
  });
});

describe('stars', () => {
  const seed = (starred: boolean) => {
    const m = makeMessage({ seq: 1, starred });
    useChatStore.setState({
      threads: {
        [CONV]: {
          messages: [m],
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
        },
      },
    });
    return m;
  };

  it.each([
    [false, ENDPOINTS.messages.star, true],
    [true, ENDPOINTS.messages.unstar, false],
  ])('starred=%s calls the right endpoint and flips the flag', async (was, endpoint, now) => {
    const m = seed(was);
    await toggleStar(m);
    expect(api.call).toHaveBeenCalledWith(endpoint, {
      params: { conversation_id: CONV, message_id: m.message_id },
    });
    expect(useChatStore.getState().threads[CONV]?.messages[0]?.starred).toBe(now);
  });

  it('a failure leaves the flag alone and says so', async () => {
    const m = seed(false);
    api.call.mockRejectedValueOnce(new Error('x'));
    await toggleStar(m);
    expect(useChatStore.getState().threads[CONV]?.messages[0]?.starred).toBe(false);
    expect(notify.error).toHaveBeenCalledWith("Couldn't update the star.");
  });

  it('starring a message in a thread that is not loaded is harmless', async () => {
    await expect(toggleStar(makeMessage({ seq: 1 }))).resolves.toBeUndefined();
  });
});

describe('starred panel', () => {
  const open = () => render(<StarredPanel open onClose={vi.fn()} />);

  it('lists starred messages with the chat and a preview', async () => {
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
    api.call.mockResolvedValue({
      items: [makeMessage({ seq: 1, content: { type: 'text', text: 'keep this' }, starred: true })],
      next_cursor: null,
    });
    open();
    expect(await screen.findByText('keep this')).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('says so when nothing is starred', async () => {
    api.call.mockResolvedValue({ items: [], next_cursor: null });
    open();
    expect(await screen.findByText('No starred messages')).toBeInTheDocument();
  });

  it('shows an error with Retry that loads again', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValueOnce(new Error('x'));
    open();
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    api.call.mockResolvedValueOnce({ items: [], next_cursor: null });
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('No starred messages')).toBeInTheDocument();
  });

  it('Load more appends the next page using the cursor', async () => {
    const user = userEvent.setup();
    api.call
      .mockResolvedValueOnce({
        items: [makeMessage({ seq: 1, content: { type: 'text', text: 'first' } })],
        next_cursor: 'c2',
      })
      .mockResolvedValueOnce({
        items: [makeMessage({ seq: 2, content: { type: 'text', text: 'second' } })],
        next_cursor: null,
      });
    open();
    await screen.findByText('first');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('second')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(api.call).toHaveBeenLastCalledWith(ENDPOINTS.messages.starred, {
      query: { cursor: 'c2' },
    });
  });

  it('Unstar removes the row; opening one closes the panel and jumps', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const m = makeMessage({ seq: 4, content: { type: 'text', text: 'jump here' }, starred: true });
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
    api.call.mockResolvedValue({ items: [m], next_cursor: null });
    render(<StarredPanel open onClose={onClose} />);
    await user.click(await screen.findByText('jump here'));
    expect(onClose).toHaveBeenCalled();
    expect(useJumpStore.getState().target).toEqual({
      conversationId: CONV,
      messageId: m.message_id,
      seq: 4,
    });

    await user.click(screen.getByRole('button', { name: 'Unstar: jump here' }));
    await waitFor(() => {
      expect(screen.queryByText('jump here')).not.toBeInTheDocument();
    });
  });
});

describe('jump to a message', () => {
  const setThread = (messages: ReturnType<typeof makeMessage>[], over = {}) =>
    useChatStore.setState({
      conversations: { [CONV]: makeConversation() },
      threads: {
        [CONV]: {
          messages,
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
          ...over,
        },
      },
    });

  it('jumpTo selects the chat and sets the target; flash clears itself after 2 s', () => {
    vi.useFakeTimers();
    const m = makeMessage({ seq: 3 });
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
    useJumpStore.getState().jumpTo(m);
    expect(useChatStore.getState().selectedId).toBe(CONV);
    useJumpStore.getState().flash(m.message_id);
    expect(useJumpStore.getState().flashId).toBe(m.message_id);
    vi.advanceTimersByTime(2000);
    expect(useJumpStore.getState().flashId).toBeNull();
  });

  it('a newer flash is not cleared by an older timer', () => {
    vi.useFakeTimers();
    useJumpStore.getState().flash('a');
    vi.advanceTimersByTime(1000);
    useJumpStore.getState().flash('b');
    vi.advanceTimersByTime(1500);
    expect(useJumpStore.getState().flashId).toBe('b');
  });

  it('scrolls to a loaded message, flashes it and clears the target', () => {
    const m = makeMessage({ seq: 3 });
    setThread([makeMessage({ seq: 2 }), m]);
    const scrollTo = vi.fn();
    useJumpStore.setState({ target: { conversationId: CONV, messageId: m.message_id, seq: 3 } });
    renderHook(() => {
      useJumpEffect(CONV, scrollTo);
    });
    expect(scrollTo).toHaveBeenCalledWith(m);
    expect(useJumpStore.getState()).toMatchObject({ target: null, flashId: m.message_id });
  });

  it('ignores a target in another conversation', () => {
    setThread([makeMessage({ seq: 2 })]);
    const scrollTo = vi.fn();
    useJumpStore.setState({ target: { conversationId: nextId(), messageId: 'x', seq: 1 } });
    renderHook(() => {
      useJumpEffect(CONV, scrollTo);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(useJumpStore.getState().target).not.toBeNull();
  });

  it('loads older pages until the message appears, then scrolls', async () => {
    const target = makeMessage({ seq: 3 });
    setThread([makeMessage({ seq: 10 })], { hasOlder: true });
    api.call.mockResolvedValueOnce({ items: [makeMessage({ seq: 9 })], next_cursor: 'm' });
    api.call.mockResolvedValueOnce({ items: [target], next_cursor: null });
    const scrollTo = vi.fn();
    useJumpStore.setState({
      target: { conversationId: CONV, messageId: target.message_id, seq: 3 },
    });
    renderHook(() => {
      useJumpEffect(CONV, scrollTo);
    });
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalled();
    });
    expect(api.call).toHaveBeenCalledTimes(2);
  });

  it('says the message is gone when history passed it without finding it', () => {
    setThread([makeMessage({ seq: 2 })], { hasOlder: true });
    useJumpStore.setState({ target: { conversationId: CONV, messageId: nextId(), seq: 5 } });
    renderHook(() => {
      useJumpEffect(CONV, vi.fn());
    });
    expect(notify.info).toHaveBeenCalledWith("That message isn't available any more.");
    expect(useJumpStore.getState().target).toBeNull();
  });

  it('says the same when there is no older history at all', () => {
    setThread([makeMessage({ seq: 20 })], { hasOlder: false });
    useJumpStore.setState({ target: { conversationId: CONV, messageId: nextId(), seq: 1 } });
    renderHook(() => {
      useJumpEffect(CONV, vi.fn());
    });
    expect(notify.info).toHaveBeenCalled();
  });

  it('waits while the thread is still loading', () => {
    setThread([], { status: 'loading' });
    useJumpStore.setState({ target: { conversationId: CONV, messageId: nextId(), seq: 1 } });
    act(() => {
      renderHook(() => {
        useJumpEffect(CONV, vi.fn());
      });
    });
    expect(notify.info).not.toHaveBeenCalled();
    expect(useJumpStore.getState().target).not.toBeNull();
  });
});

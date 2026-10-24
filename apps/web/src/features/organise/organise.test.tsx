import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
} from '../../../test/fakes';
import { MessageInput } from '../chat/components/MessageInput';
import { Sidebar } from '../chat/components/Sidebar';
import * as outbox from '../chat/outbox/useOutboxStore';
import { useChatStore } from '../chat/useChatStore';
import { LockModal, LockScreen } from './ChatLock';
import { visibleChats } from './chatFilters';
import { useDraftStore } from './drafts';
import { hashPasscode, useLockStore } from './lock';
import { forwardContent, forwardMessage } from './messageActions';
import { MUTE_OPTIONS, mutedUntilFor, updatePrefs } from './prefs';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const withPrefs = (id: string, prefs: Partial<ReturnType<typeof makeConversation>['prefs']>) =>
  makeConversation({ id, prefs: { ...makeConversation().prefs, ...prefs } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useChatStore.getState().reset();
  useDraftStore.setState({ drafts: {} });
  useLockStore.setState({ unlocked: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

describe('chat list filters', () => {
  const a = withPrefs(nextId(), {});
  const unread = { ...withPrefs(nextId(), {}), unread_count: 2 };
  const fav = withPrefs(nextId(), { favorite: true });
  const group = { ...withPrefs(nextId(), {}), type: 'group' as const, title: 'Team' };
  const archived = withPrefs(nextId(), { archived: true });
  const all = [a, unread, fav, group, archived];

  it('All hides archived chats; the Archived view shows only them', () => {
    expect(visibleChats(all, 'all', 'chats')).toHaveLength(4);
    expect(visibleChats(all, 'all', 'archived')).toEqual([archived]);
  });

  it('Unread, Favourites and Groups narrow the list', () => {
    expect(visibleChats(all, 'unread', 'chats')).toEqual([unread]);
    expect(visibleChats(all, 'favorites', 'chats')).toEqual([fav]);
    expect(visibleChats(all, 'groups', 'chats')).toEqual([group]);
  });

  it('puts pinned chats first', () => {
    const pinned = withPrefs(nextId(), { pinned: true });
    expect(visibleChats([a, pinned], 'all', 'chats')[0]).toBe(pinned);
  });

  it('the sidebar tabs and the Archived section work from the keyboard-reachable buttons', async () => {
    const user = userEvent.setup();
    installFakeServices();
    const chats = [a, unread, archived].map((c, i) => ({
      ...c,
      peer: { ...makeConversation().peer!, id: nextId(), display_name: `Person ${i}` },
    }));
    useChatStore.setState({
      listStatus: 'ready',
      conversations: Object.fromEntries(chats.map((c) => [c.id, c])),
    });
    render(<Sidebar />);
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByRole('option', { name: /Person 2/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});

describe('chat prefs', () => {
  it('shows the server error when the pin limit is hit and leaves the chat unpinned', async () => {
    const { api } = installFakeServices();
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockRejectedValue(
      new ApiError({ status: 409, code: 'CONFLICT', message: 'You can pin at most 3 chats' }),
    );

    const ok = await updatePrefs(conv.id, { pinned: true });

    expect(ok).toBe(false);
    expect(notify.error).toHaveBeenCalledWith('You can pin at most 3 chats');
    expect(useChatStore.getState().conversations[conv.id]?.prefs.pinned).toBe(false);
  });

  it('stores the prefs the server answers with', async () => {
    const { api } = installFakeServices();
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockResolvedValue({ ...conv.prefs, pinned: true });

    await updatePrefs(conv.id, { pinned: true });

    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.updatePrefs, {
      params: { conversation_id: conv.id },
      body: { pinned: true },
    });
    expect(useChatStore.getState().conversations[conv.id]?.prefs.pinned).toBe(true);
  });

  it('mute durations: 1h, 8h, 1 week and always', () => {
    const now = Date.UTC(2026, 0, 1);
    const until = (id: string) => mutedUntilFor(MUTE_OPTIONS.find((o) => o.id === id)!.ms, now);
    expect(until('1h')).toBe('2026-01-01T01:00:00.000Z');
    expect(until('8h')).toBe('2026-01-01T08:00:00.000Z');
    expect(until('1w')).toBe('2026-01-08T00:00:00.000Z');
    expect(Date.parse(until('always'))).toBeGreaterThan(Date.UTC(2090, 0, 1));
  });
});

describe('chat lock', () => {
  it('hashes with the chat id as the salt and never returns the passcode', async () => {
    const h1 = await hashPasscode('chat-1', '1234');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain('1234');
    expect(await hashPasscode('chat-1', '1234')).toBe(h1); // same on another device
    expect(await hashPasscode('chat-2', '1234')).not.toBe(h1); // different salt
    expect(await hashPasscode('chat-1', '4321')).not.toBe(h1);
  });

  it('sends only the hash to the server when a passcode is set', async () => {
    const user = userEvent.setup();
    const { api } = installFakeServices();
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockResolvedValue({ ...conv.prefs, locked: true });
    render(<LockModal conversation={conv} mode="set" open onClose={() => undefined} />);

    await user.type(screen.getByLabelText('New passcode'), 'hunter22');
    await user.type(screen.getByLabelText('Repeat passcode'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Lock chat' }));

    await waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    const body = JSON.stringify(api.call.mock.calls[0]);
    expect(body).not.toContain('hunter22');
    expect(body).toContain(await hashPasscode(conv.id, 'hunter22'));
    expect(screen.getByText(/does not enforce the lock/)).toBeInTheDocument();
  });

  it('rejects a passcode that does not match its repeat', async () => {
    const user = userEvent.setup();
    const { api } = installFakeServices();
    render(
      <LockModal conversation={makeConversation()} mode="set" open onClose={() => undefined} />,
    );
    await user.type(screen.getByLabelText('New passcode'), 'hunter22');
    await user.type(screen.getByLabelText('Repeat passcode'), 'hunter23');
    await user.click(screen.getByRole('button', { name: 'Lock chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('stays locked on a wrong passcode and unlocks on the right one', async () => {
    const user = userEvent.setup();
    installFakeServices();
    const hash = await hashPasscode(CONV, 'open-sesame');
    const conv = withPrefs(CONV, { locked: true, lock_hash: hash });
    render(<LockScreen conversation={conv} />);

    await user.type(screen.getByLabelText('Passcode'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');
    expect(useLockStore.getState().unlocked[CONV]).toBeUndefined();

    await user.type(screen.getByLabelText('Passcode'), 'open-sesame');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(useLockStore.getState().unlocked[CONV]).toBe(true);
    });
  });

  it('hides the message text of a locked chat in the chat list', () => {
    installFakeServices();
    const conv = {
      ...withPrefs(CONV, { locked: true, lock_hash: 'x'.repeat(64) }),
      last_message: makeMessage({ content: { type: 'text', text: 'secret plan' } }),
    };
    useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
    render(<Sidebar />);
    expect(screen.queryByText('secret plan')).not.toBeInTheDocument();
    expect(screen.getByText('Locked chat')).toBeInTheDocument();
  });
});

describe('forward', () => {
  it('marks the copy as forwarded and drops reply, mentions and view-once', () => {
    const content = forwardContent({
      type: 'text',
      text: 'hi',
      reply_to: nextId(),
      mentions: [BOB],
    });
    expect(content).toEqual({ type: 'text', text: 'hi', forwarded: true });
    expect(forwardContent({ type: 'text', text: 'x', view_once: true })).toBeNull();
    expect(forwardContent(null)).toBeNull();
  });

  it('sends one normal message per chosen chat', () => {
    const send = vi.spyOn(outbox, 'sendMessage').mockReturnValue('id');
    const message = makeMessage({ content: { type: 'text', text: 'forward me' } });
    const [c1, c2] = [nextId(), nextId()];

    expect(forwardMessage(ME, message, [c1, c2])).toBe(true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(ME, c1, {
      type: 'text',
      text: 'forward me',
      forwarded: true,
    });
    expect(send).toHaveBeenCalledWith(ME, c2, {
      type: 'text',
      text: 'forward me',
      forwarded: true,
    });
  });

  it('refuses types that cannot be forwarded', () => {
    const send = vi.spyOn(outbox, 'sendMessage');
    const message = makeMessage({
      content: {
        type: 'system',
        event: 'renamed',
        actor_user_id: null,
        target_user_ids: [],
      },
    });
    expect(forwardMessage(ME, message, [nextId()])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('drafts', () => {
  it('keeps a draft in memory and localStorage, and drops it when emptied', () => {
    useDraftStore.getState().setDraft(CONV, 'half a thought');
    expect(useDraftStore.getState().drafts[CONV]).toBe('half a thought');
    expect(JSON.parse(localStorage.getItem('flick:drafts')!)).toEqual({ [CONV]: 'half a thought' });

    useDraftStore.getState().setDraft(CONV, '   ');
    expect(useDraftStore.getState().drafts[CONV]).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('flick:drafts')!)).toEqual({});
  });

  it('shows "Draft: ..." in the chat list', () => {
    installFakeServices();
    const conv = {
      ...makeConversation(),
      last_message: makeMessage({ content: { type: 'text', text: 'older message' } }),
    };
    useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
    useDraftStore.setState({ drafts: { [conv.id]: 'not sent yet' } });
    render(<Sidebar />);
    expect(screen.getByText('Draft:')).toBeInTheDocument();
    expect(screen.getByText('not sent yet')).toBeInTheDocument();
    expect(screen.queryByText('older message')).not.toBeInTheDocument();
  });

  it('the composer saves what you type, restores it, and clears it on send', async () => {
    const user = userEvent.setup();
    installFakeServices();
    vi.spyOn(outbox, 'sendMessage').mockReturnValue('id');
    const conv = makeConversation();

    const first = render(<MessageInput conversation={conv} messages={[]} />);
    await user.type(screen.getByLabelText(/Message Bob/), 'remember me');
    expect(useDraftStore.getState().drafts[conv.id]).toBe('remember me');
    first.unmount();

    render(<MessageInput conversation={conv} messages={[]} />);
    const input = screen.getByLabelText(/Message Bob/);
    expect(input).toHaveValue('remember me');
    await user.type(input, '{Enter}');
    expect(useDraftStore.getState().drafts[conv.id]).toBeUndefined();
  });
});

describe('mention autocomplete', () => {
  const bob = { id: BOB, username: 'bob', display_name: 'Bob B', avatar_url: null, is_bot: false };

  it('suggests members after @, inserts the username and sends the mentioned id', async () => {
    const user = userEvent.setup();
    const { api } = installFakeServices();
    api.call.mockResolvedValue({ items: [bob] });
    const send = vi.spyOn(outbox, 'sendMessage').mockReturnValue('id');
    const conv = makeConversation();
    render(<MessageInput conversation={conv} messages={[]} />);
    const input = screen.getByLabelText(/Message Bob/);

    await user.type(input, 'hello @bo');

    expect(await screen.findByRole('option', { name: /Bob B/ })).toBeInTheDocument();
    expect(api.call).toHaveBeenLastCalledWith(ENDPOINTS.conversations.mentionCandidates, {
      params: { conversation_id: conv.id },
      query: { q: 'bo', limit: 8 },
    });

    await user.keyboard('{Enter}');
    expect(input).toHaveValue('hello @bob ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(send).toHaveBeenCalledWith(ME, conv.id, {
      type: 'text',
      text: 'hello @bob',
      mentions: [BOB],
    });
  });

  it('Escape closes the list without changing the text', async () => {
    const user = userEvent.setup();
    const { api } = installFakeServices();
    api.call.mockResolvedValue({ items: [bob] });
    render(<MessageInput conversation={makeConversation()} messages={[]} />);
    const input = screen.getByLabelText(/Message Bob/);
    await user.type(input, '@b');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('@b');
  });
});

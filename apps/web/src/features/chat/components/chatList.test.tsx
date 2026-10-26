// The chat list: states, rows, badges, ordering, filters, keyboard and the dialogs it opens.
import { RouterWrapper } from '../../../../test/router';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useDraftStore } from '../../organise/drafts';
import { useLockStore } from '../../organise/lock';
import {
  BOB,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { useChatStore } from '../useChatStore';
import { Sidebar } from './Sidebar';

let api: FakeApi;
const person = (name: string) => ({
  id: nextId(),
  username: name.toLowerCase(),
  display_name: name,
  avatar_url: null,
  is_bot: false,
});

const chat = (name: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  ...makeConversation({ id: nextId(), ...over }),
  peer: over.type === 'group' ? null : person(name),
  ...(over.type === 'group' ? { title: name } : {}),
});
const withPrefs = (
  c: ConversationSummary,
  prefs: Partial<ConversationSummary['prefs']>,
): ConversationSummary => ({
  ...c,
  prefs: { ...c.prefs, ...prefs },
});
const setChats = (...chats: ConversationSummary[]) =>
  useChatStore.setState({
    listStatus: 'ready',
    conversations: Object.fromEntries(chats.map((c) => [c.id, c])),
  });
const names = () =>
  screen.queryAllByRole('option').map((o) => o.querySelector('.truncate')?.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  api.call.mockResolvedValue({ items: [], next_cursor: null });
  useChatStore.getState().reset();
  useDraftStore.setState({ drafts: {} });
  useLockStore.setState({ unlocked: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

describe('states', () => {
  it.each(['idle', 'loading'] as const)(
    '%s with nothing loaded shows the skeleton',
    (listStatus) => {
      useChatStore.setState({ listStatus });
      render(<Sidebar />, { wrapper: RouterWrapper });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Search chats')).not.toBeInTheDocument();
    },
  );

  it('loading with chats already there keeps showing them', () => {
    setChats(chat('Ann'));
    useChatStore.setState({ listStatus: 'loading' });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names()).toEqual(['Ann']);
  });

  it('no chats at all invites the first one', () => {
    useChatStore.setState({ listStatus: 'ready' });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    expect(screen.getByText('Start a new chat to say hello.')).toBeInTheDocument();
  });

  it('an error shows the reason and Retry loads again', async () => {
    const user = userEvent.setup();
    useChatStore.setState({ listStatus: 'error', listError: 'Offline' });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText("Couldn't load chats")).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.list, expect.anything());
  });

  it('an error with chats already loaded keeps the chats', () => {
    setChats(chat('Ann'));
    useChatStore.setState({ listStatus: 'error', listError: 'x' });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names()).toEqual(['Ann']);
  });
});

describe('rows', () => {
  it('shows the last message preview, "You:" for my own, and the time', () => {
    const mine = chat('Ann', {
      last_message: makeMessage({
        seq: 1,
        sender_user_id: ME,
        content: { type: 'text', text: 'on my way' },
      }),
    });
    const theirs = chat('Ben', {
      last_message: makeMessage({
        seq: 1,
        sender_user_id: BOB,
        content: { type: 'text', text: 'see you' },
      }),
    });
    setChats(mine, theirs);
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('You:')).toBeInTheDocument();
    expect(screen.getByText('on my way')).toBeInTheDocument();
    expect(screen.getByText('see you')).toBeInTheDocument();
  });

  it('a chat with no messages says to start', () => {
    setChats(chat('Ann'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('Tap to start chatting')).toBeInTheDocument();
  });

  it('a draft shows in red and is replaced by the preview once the chat is open', () => {
    const c = chat('Ann', {
      last_message: makeMessage({ seq: 1, content: { type: 'text', text: 'old' } }),
    });
    setChats(c);
    useDraftStore.setState({ drafts: { [c.id]: 'half written' } });
    const { rerender } = render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('Draft:')).toBeInTheDocument();
    expect(screen.getByText('half written')).toBeInTheDocument();
    useChatStore.setState({ selectedId: c.id });
    rerender(<Sidebar />);
    expect(screen.queryByText('Draft:')).not.toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
  });

  it.each([
    [0, null],
    [1, '1 unread'],
    [12, '12 unread'],
    [150, '150 unread'],
  ])('%i unread -> badge %s', (count, label) => {
    setChats(chat('Ann', { unread_count: count }));
    render(<Sidebar />, { wrapper: RouterWrapper });
    if (label) expect(screen.getByLabelText(label)).toBeInTheDocument();
    else expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument();
  });

  it('a very large unread count is shortened, with the full count still spoken', () => {
    setChats(chat('Ann', { unread_count: 5000 }));
    render(<Sidebar />, { wrapper: RouterWrapper });
    const badge = screen.getByLabelText('5000 unread');
    expect(badge.textContent.length).toBeLessThan(5);
  });

  it('shows pinned, favourite and muted markers', () => {
    setChats(
      withPrefs(chat('Pinned'), { pinned: true }),
      withPrefs(chat('Fav'), { favorite: true }),
      withPrefs(chat('Muted'), { muted_until: '2999-01-01T00:00:00.000Z' }),
      withPrefs(chat('Expired mute'), { muted_until: '2000-01-01T00:00:00.000Z' }),
    );
    render(<Sidebar />, { wrapper: RouterWrapper });
    // Two: the always-pinned Saved messages row and the pinned chat.
    expect(screen.getAllByRole('img', { name: 'Pinned' })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Favourite' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'Muted' })).toHaveLength(1);
  });

  it('a locked chat hides its text and shows a lock note; a draft does not leak either', () => {
    const c = withPrefs(
      chat('Ann', {
        last_message: makeMessage({ seq: 1, content: { type: 'text', text: 'secret' } }),
      }),
      { locked: true, lock_hash: 'h' },
    );
    setChats(c);
    useDraftStore.setState({ drafts: { [c.id]: 'also secret' } });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('Locked chat')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.queryByText('also secret')).not.toBeInTheDocument();
  });

  it('the open chat is marked selected; the online dot shows for an online peer', () => {
    const c = chat('Ann');
    setChats(c);
    useChatStore.setState({
      selectedId: c.id,
      presence: { [c.peer!.id]: { online: true, last_seen_at: null } },
    });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
  });

  it('a group shows its title', () => {
    setChats(chat('Team', { type: 'group' }));
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names()).toEqual(['Team']);
  });

  it('clicking a row opens that chat', async () => {
    const user = userEvent.setup();
    const c = chat('Ann');
    setChats(c);
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByRole('option'));
    expect(useChatStore.getState().selectedId).toBe(c.id);
  });
});

describe('ordering', () => {
  it('pinned first, then newest activity first', () => {
    const old = chat('Old', {
      last_message: makeMessage({ seq: 1, created_at: '2026-01-01T00:00:00.000Z' }),
    });
    const recent = chat('Recent', {
      last_message: makeMessage({ seq: 1, created_at: '2026-03-01T00:00:00.000Z' }),
    });
    const pinnedOld = withPrefs(
      chat('PinnedOld', {
        last_message: makeMessage({ seq: 1, created_at: '2025-01-01T00:00:00.000Z' }),
      }),
      { pinned: true },
    );
    setChats(old, recent, pinnedOld);
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names()).toEqual(['PinnedOld', 'Recent', 'Old']);
  });

  it('a new message moves its chat to the top', () => {
    const a = chat('A', {
      last_message: makeMessage({ seq: 1, created_at: '2026-01-01T00:00:00.000Z' }),
    });
    const b = chat('B', {
      last_message: makeMessage({ seq: 1, created_at: '2026-02-01T00:00:00.000Z' }),
    });
    setChats(a, b);
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names()).toEqual(['B', 'A']);
    act(() => {
      useChatStore.setState((s) => ({
        conversations: {
          ...s.conversations,
          [a.id]: {
            ...a,
            last_message: makeMessage({ seq: 2, created_at: '2026-04-01T00:00:00.000Z' }),
          },
        },
      }));
    });
    expect(names()).toEqual(['A', 'B']);
  });
});

describe('filters and search', () => {
  const ann = chat('Ann', { unread_count: 2 });
  const ben = withPrefs(chat('Ben'), { favorite: true });
  const team = chat('Team', { type: 'group' });
  const gone = withPrefs(chat('Gone'), { archived: true });

  it('All / Unread / Favourites / Groups', async () => {
    const user = userEvent.setup();
    setChats(ann, ben, team, gone);
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(names().sort()).toEqual(['Ann', 'Ben', 'Team']);
    for (const [tab, expected] of [
      ['Unread', ['Ann']],
      ['Favourites', ['Ben']],
      ['Groups', ['Team']],
      ['All', ['Ann', 'Ben', 'Team']],
    ] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      expect(names().sort()).toEqual([...expected]);
    }
  });

  it('a tab with nothing shows "No matches found"', async () => {
    const user = userEvent.setup();
    setChats(chat('Ann'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('search matches names case-insensitively and combines with the tab', async () => {
    const user = userEvent.setup();
    setChats(ann, chat('Anna', { unread_count: 0 }), ben);
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.type(screen.getByLabelText('Search chats'), 'ANN');
    expect(names().sort()).toEqual(['Ann', 'Anna']);
    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(names()).toEqual(['Ann']);
  });

  it('the Archived section lists archived chats and goes back', async () => {
    const user = userEvent.setup();
    setChats(ann, gone);
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(names()).toEqual(['Gone']);
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(names()).toEqual(['Ann']);
  });

  it('no Archived entry when nothing is archived', () => {
    setChats(ann);
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.queryByRole('button', { name: /Archived/ })).not.toBeInTheDocument();
  });
});

describe('keyboard', () => {
  const three = () => {
    const chats = ['A', 'B', 'C'].map((n, i) =>
      chat(n, {
        last_message: makeMessage({ seq: 1, created_at: `2026-01-0${3 - i}T00:00:00.000Z` }),
      }),
    );
    setChats(...chats);
    return chats;
  };

  it('exactly one row is tabbable (roving tabindex)', () => {
    three();
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getAllByRole('option').filter((o) => o.tabIndex === 0)).toHaveLength(1);
  });

  it('arrows, Home and End move focus; Enter and Space open', async () => {
    const user = userEvent.setup();
    three();
    render(<Sidebar />, { wrapper: RouterWrapper });
    const rows = screen.getAllByRole('option');
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(rows[2]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[2]).toHaveFocus(); // clamps
    await user.keyboard('{Home}');
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(useChatStore.getState().selectedId).toBe(rows[1]!.dataset.conversationId);
    useChatStore.getState().select(null);
    await user.keyboard(' ');
    expect(useChatStore.getState().selectedId).toBe(rows[1]!.dataset.conversationId);
  });

  it('ArrowDown in the search box jumps to the first row', async () => {
    const user = userEvent.setup();
    three();
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByLabelText('Search chats'));
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveFocus();
  });
});

describe('dialogs the list opens', () => {
  it.each([
    ['New chat', 'New chat'],
    ['New group', 'New group'],
    ['Search messages', 'Search messages'],
    ['Starred messages', 'Starred messages'],
  ])('the %s button opens its dialog, Escape closes it', async (button, heading) => {
    const user = userEvent.setup();
    setChats(chat('Ann'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByRole('button', { name: button }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations for a full list', async () => {
    setChats(
      chat('Ann', {
        unread_count: 3,
        last_message: makeMessage({ seq: 1, content: { type: 'text', text: 'hello' } }),
      }),
      withPrefs(chat('Ben'), {
        pinned: true,
        favorite: true,
        muted_until: '2999-01-01T00:00:00.000Z',
      }),
      chat('Team', { type: 'group' }),
      withPrefs(chat('Gone'), { archived: true }),
    );
    const { container } = render(<Sidebar />, { wrapper: RouterWrapper });
    await expectNoA11yViolations(container);
  });

  it.each([
    ['empty', () => useChatStore.setState({ listStatus: 'ready' })],
    ['error', () => useChatStore.setState({ listStatus: 'error', listError: 'x' })],
    ['loading', () => useChatStore.setState({ listStatus: 'loading' })],
  ])('has no violations when %s', async (_n, setup) => {
    setup();
    const { container } = render(<Sidebar />, { wrapper: RouterWrapper });
    await expectNoA11yViolations(container);
  });
});

describe('phone header menu and row call buttons', () => {
  it('the "⋮" menu also holds starred, scheduled, reminders and new group (shown on phones only)', async () => {
    const user = userEvent.setup();
    setChats(chat('Ann'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    await user.click(screen.getByRole('button', { name: 'Chat list menu' }));
    const menu = screen.getByRole('menu', { name: 'Chat list menu' });
    for (const label of ['Starred messages', 'Scheduled messages', 'Reminders', 'New group']) {
      const item = within(menu).getByRole('menuitem', { name: label });
      expect(item).toHaveClass('sm:hidden');
    }
    // Their round buttons are hidden on phones; search, new chat and "⋮" stay.
    expect(screen.getByRole('button', { name: 'Starred messages' })).toHaveClass('max-sm:hidden');
    expect(screen.getByRole('button', { name: 'Search messages' })).not.toHaveClass(
      'max-sm:hidden',
    );
    expect(screen.getByRole('button', { name: 'New chat' })).not.toHaveClass('max-sm:hidden');
    await user.click(within(menu).getByRole('menuitem', { name: 'Reminders' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a person row has video and voice call buttons for phones that start the call without opening the chat', async () => {
    const { useCallStore } = await import('@/features/calls/useCallStore');
    const initiateCall = vi.fn();
    useCallStore.setState({ initiateCall, callStatus: 'idle' } as never);
    const user = userEvent.setup();
    const ann = chat('Ann');
    setChats(ann);
    render(<Sidebar />, { wrapper: RouterWrapper });
    const video = screen.getByTestId('row-video-call');
    expect(video.parentElement).toHaveClass('sm:hidden');
    await user.click(video);
    expect(initiateCall).toHaveBeenCalledWith(ann.id, ann.peer, 'video');
    await user.click(screen.getByTestId('row-audio-call'));
    expect(initiateCall).toHaveBeenLastCalledWith(ann.id, ann.peer, 'audio');
    expect(useChatStore.getState().selectedId).not.toBe(ann.id);
  });

  it('groups and the Flick chat have no call buttons', () => {
    setChats(chat('Team', { type: 'group' }));
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.queryByTestId('row-video-call')).not.toBeInTheDocument();
  });
});

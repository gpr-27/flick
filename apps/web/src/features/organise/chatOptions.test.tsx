// The "⋮" chat menu (pin, archive, favourite, mute, wallpaper, lock, search), the lock dialogs
// and the forward dialog.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type ChatPrefs, type ConversationSummary } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useChatStore } from '../chat/useChatStore';
import { useOutboxStore, configureOutboxStorage } from '../chat/outbox/useOutboxStore';
import {
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../test/fakes';
import { expectNoA11yViolations } from '../../../test/a11y';
import { createMemoryKv } from '@/lib/idb';
import type { OutboxItem } from '../chat/outbox/outboxMachine';
import { LockModal, LockScreen } from './ChatLock';
import { ChatOptionsMenu } from './ChatOptionsMenu';
import { ForwardModal } from './ForwardModal';
import { hashPasscode, useLockStore } from './lock';

let api: FakeApi;
const withPrefs = (prefs: Partial<ChatPrefs>): ConversationSummary => {
  const base = makeConversation();
  return { ...base, prefs: { ...base.prefs, ...prefs } };
};

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  useLockStore.setState({ unlocked: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  vi.spyOn(notify, 'error').mockImplementation(() => '');
  vi.spyOn(notify, 'success').mockImplementation(() => '');
});

const mountMenu = (conv: ConversationSummary, onSearch = vi.fn(), phoneItems = []) => {
  useChatStore.setState({ conversations: { [conv.id]: conv }, selectedId: conv.id });
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.chatLists.list
        ? { items: [] }
        : endpoint === ENDPOINTS.ai.chatPrivacy
          ? { allow: true }
          : conv.prefs,
    ),
  );
  render(<ChatOptionsMenu conversation={conv} onSearch={onSearch} phoneItems={phoneItems} />);
  return userEvent.setup();
};
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Chat options' }));
  return screen.getByRole('menu', { name: 'Chat options' });
};
const patchBody = () => (api.call.mock.calls.at(-1)?.[1] as { body: Partial<ChatPrefs> }).body;

describe('chat options menu', () => {
  it('lists the actions for a plain chat', async () => {
    const user = mountMenu(withPrefs({}));
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Pin chat',
      'Archive chat',
      'Add to favourites',
      'Mute…',
      'Wallpaper…',
      'Colour and sound…',
      'Folders and tags…',
      'Lock chat…',
      'Search in chat',
      'Remind me about this chat',
      'Snooze chat…',
      'Export chat…',
      'Summarise chat',
      'Ask Flick about this chat',
      'Topics in this chat',
      'Recap with Flick…',
      'No-AI mode: turn on',
      'Create event…',
    ]);
  });

  it('reflects current state: pinned, archived, favourite, muted and locked', async () => {
    const user = mountMenu(
      withPrefs({
        pinned: true,
        archived: true,
        favorite: true,
        muted_until: '2999-01-01T00:00:00.000Z',
        locked: true,
        lock_hash: 'h',
      }),
    );
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Unpin chat',
      'Unarchive chat',
      'Remove from favourites',
      'Unmute',
      'Wallpaper…',
      'Colour and sound…',
      'Folders and tags…',
      'Lock now',
      'Remove chat lock…',
      'Search in chat',
      'Remind me about this chat',
      'Snooze chat…',
      'Export chat…',
      'Summarise chat',
      'Ask Flick about this chat',
      'Topics in this chat',
      'Recap with Flick…',
      'No-AI mode: turn on',
      'Create event…',
    ]);
  });

  it('the trigger reports whether the menu is open', async () => {
    const user = mountMenu(withPrefs({}));
    const trigger = screen.getByRole('button', { name: 'Chat options' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  // [item, prefs before, PATCH body]
  const table: [string, Partial<ChatPrefs>, Partial<ChatPrefs>][] = [
    ['Pin chat', {}, { pinned: true }],
    ['Unpin chat', { pinned: true }, { pinned: false }],
    ['Archive chat', {}, { archived: true }],
    ['Unarchive chat', { archived: true }, { archived: false }],
    ['Add to favourites', {}, { favorite: true }],
    ['Remove from favourites', { favorite: true }, { favorite: false }],
    ['Unmute', { muted_until: '2999-01-01T00:00:00.000Z' }, { muted_until: null }],
  ];
  it.each(table)('%s sends %j and closes the menu', async (name, prefs, body) => {
    const user = mountMenu(withPrefs(prefs));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.updatePrefs,
      expect.objectContaining({ params: { conversation_id: CONV }, body }),
    );
    expect(screen.queryByRole('menu', { name: 'Chat options' })).not.toBeInTheDocument();
  });

  it('archiving closes the chat; unarchiving does not', async () => {
    const user = mountMenu(withPrefs({}));
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archive chat' }));
    await waitFor(() => {
      expect(useChatStore.getState().selectedId).toBeNull();
    });
  });

  it('a server refusal (pin limit) is shown to the user', async () => {
    const user = mountMenu(withPrefs({}));
    await openMenu(user);
    api.call.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('menuitem', { name: 'Pin chat' }));
    await waitFor(() => {
      expect(notify.error).toHaveBeenCalled();
    });
  });

  it('Search in chat calls onSearch', async () => {
    const onSearch = vi.fn();
    const user = mountMenu(withPrefs({}), onSearch);
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Search in chat' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('Lock now re-locks without asking the server', async () => {
    const user = mountMenu(withPrefs({ locked: true, lock_hash: 'h' }));
    useLockStore.setState({ unlocked: { [CONV]: true } });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Lock now' }));
    expect(useLockStore.getState().unlocked[CONV]).toBeUndefined();
    // The menu looks a few things up when it opens, but locking changes nothing on the server.
    expect(api.call).not.toHaveBeenCalledWith(
      ENDPOINTS.conversations.updatePrefs,
      expect.anything(),
    );
  });

  describe('keyboard', () => {
    it('focus moves into the menu; arrows cycle through the items and wrap', async () => {
      const user = mountMenu(withPrefs({}));
      const menu = await openMenu(user);
      const items = within(menu).getAllByRole('menuitem');
      items[0]!.focus();
      await user.keyboard('{ArrowDown}');
      expect(items[1]).toHaveFocus();
      await user.keyboard('{ArrowUp}{ArrowUp}');
      expect(items.at(-1)).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(items[0]).toHaveFocus();
    });

    it('Escape closes it and returns focus to the trigger', async () => {
      const user = mountMenu(withPrefs({}));
      const trigger = screen.getByRole('button', { name: 'Chat options' });
      await openMenu(user);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu', { name: 'Chat options' })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('a click outside closes it', async () => {
      const user = mountMenu(withPrefs({}));
      await openMenu(user);
      await user.click(document.querySelector('.fixed.inset-0.z-30')!);
      expect(screen.queryByRole('menu', { name: 'Chat options' })).not.toBeInTheDocument();
    });
  });

  describe('dialogs', () => {
    it('Mute offers 1 hour, 8 hours, 1 week and Always and saves the choice', async () => {
      const user = mountMenu(withPrefs({}));
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Mute…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Mute notifications' });
      expect(
        within(dialog)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['', '1 hour', '8 hours', '1 week', 'Always']);
      await user.click(within(dialog).getByRole('button', { name: 'Always' }));
      await waitFor(() => {
        expect(patchBody().muted_until).toMatch(/^2100-/);
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Mute notifications' }),
        ).not.toBeInTheDocument();
      });
    });

    it('Wallpaper marks the current one and saves a pick, or the default', async () => {
      const user = mountMenu(withPrefs({ wallpaper: 'mint' }));
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Wallpaper…' }));
      const group = await screen.findByRole('group', { name: 'Wallpapers' });
      expect(within(group).getByRole('button', { name: 'Mint' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(group).getByRole('button', { name: 'Same as all chats' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await user.click(within(group).getByRole('button', { name: 'Night' }));
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(patchBody()).toEqual({ wallpaper: 'night' });
    });

    it('Wallpaper "Same as all chats" sends null and the label says whose it is', async () => {
      const user = mountMenu(withPrefs({ wallpaper: 'mint' }));
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Wallpaper…' }));
      expect(await screen.findByTestId('wallpaper-status')).toHaveTextContent(
        'Custom for this chat',
      );
      await user.click(await screen.findByRole('button', { name: 'Same as all chats' }));
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(patchBody()).toEqual({ wallpaper: null });
    });

    it('Lock chat… opens the set-passcode dialog; Remove chat lock… the remove one', async () => {
      const user = mountMenu(withPrefs({}));
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Lock chat…' }));
      expect(await screen.findByRole('heading', { name: 'Lock this chat' })).toBeInTheDocument();
    });
  });

  it('on phones the header actions fold into the top of the menu and run', async () => {
    const onClick = vi.fn();
    const user = mountMenu(withPrefs({}), vi.fn(), [{ label: 'Video call', onClick }] as never);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Video call' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations (open menu, mute dialog)', async () => {
    const user = mountMenu(withPrefs({}));
    await openMenu(user);
    await expectNoA11yViolations();
    await user.click(screen.getByRole('menuitem', { name: 'Mute…' }));
    await screen.findByRole('dialog', { name: 'Mute notifications' });
    await expectNoA11yViolations();
  });
});

describe('lock dialogs', () => {
  const setMode = (conv = makeConversation()) => {
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockResolvedValue({ ...conv.prefs, locked: true });
    const onClose = vi.fn();
    render(<LockModal conversation={conv} mode="set" open onClose={onClose} />);
    return { conv, onClose, user: userEvent.setup() };
  };

  it('a passcode shorter than 4 characters is refused before anything is sent', async () => {
    const { user } = setMode();
    await user.type(screen.getByLabelText('New passcode'), 'abc');
    await user.type(screen.getByLabelText('Repeat passcode'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Lock chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 4 characters');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('the submit button waits for a passcode', () => {
    setMode();
    expect(screen.getByRole('button', { name: 'Lock chat' })).toBeDisabled();
  });

  it('setting the lock unlocks this tab, says so and closes', async () => {
    const { user, onClose, conv } = setMode();
    await user.type(screen.getByLabelText('New passcode'), 'abcd');
    await user.type(screen.getByLabelText('Repeat passcode'), 'abcd');
    await user.click(screen.getByRole('button', { name: 'Lock chat' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(notify.success).toHaveBeenCalledWith('Chat lock is on.');
    expect(useLockStore.getState().unlocked[conv.id]).toBe(true);
  });

  it('removing the lock needs the right passcode', async () => {
    const user = userEvent.setup();
    const hash = await hashPasscode(CONV, 'open-sesame');
    const conv = withPrefs({ locked: true, lock_hash: hash });
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockResolvedValue({ ...conv.prefs, locked: false, lock_hash: null });
    const onClose = vi.fn();
    render(<LockModal conversation={conv} mode="remove" open onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Remove chat lock' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Repeat passcode')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Current passcode'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Remove lock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode.');
    expect(api.call).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Current passcode'));
    await user.type(screen.getByLabelText('Current passcode'), 'open-sesame');
    await user.click(screen.getByRole('button', { name: 'Remove lock' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(patchBody()).toEqual({ locked: false, lock_hash: null });
  });

  it('Cancel and the X close without saving, and clear what was typed', async () => {
    const { user, onClose } = setMode();
    await user.type(screen.getByLabelText('New passcode'), 'abcd');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.call).not.toHaveBeenCalled();
  });

  describe('the lock screen', () => {
    const lockedConv = async () =>
      withPrefs({ locked: true, lock_hash: await hashPasscode(CONV, 'right') });

    it('Unlock is disabled with an empty passcode; a wrong one clears the field and keeps it locked', async () => {
      const user = userEvent.setup();
      render(<LockScreen conversation={await lockedConv()} />);
      expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
      const field = screen.getByLabelText('Passcode');
      expect(field).toHaveFocus();
      await user.type(field, 'wrong{Enter}');
      expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      await user.type(field, 'x');
      expect(field).toHaveAttribute('aria-invalid', 'false');
    });

    it('the right passcode unlocks for this tab only', async () => {
      const user = userEvent.setup();
      render(<LockScreen conversation={await lockedConv()} />);
      await user.type(screen.getByLabelText('Passcode'), 'right{Enter}');
      await waitFor(() => {
        expect(useLockStore.getState().unlocked[CONV]).toBe(true);
      });
      expect(sessionStorage.getItem('flick:unlocked-chats')).toContain(CONV);
    });

    it('Back to chats closes the chat; the note says it is not encryption', async () => {
      const user = userEvent.setup();
      useChatStore.setState({ selectedId: CONV });
      render(<LockScreen conversation={await lockedConv()} />);
      expect(screen.getByText(/not encryption/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Back to chats' }));
      expect(useChatStore.getState().selectedId).toBeNull();
    });

    it('is labelled by the person and has no accessibility violations', async () => {
      const { container } = render(<LockScreen conversation={await lockedConv()} />);
      expect(screen.getByRole('region', { name: 'Locked chat with Bob' })).toBeInTheDocument();
      await expectNoA11yViolations(container);
    });
  });
});

describe('forward dialog', () => {
  const chatWith = (id: string, name: string): ConversationSummary => ({
    ...makeConversation({ id }),
    peer: {
      id: nextId(),
      username: name.toLowerCase(),
      display_name: name,
      avatar_url: null,
      is_bot: false,
    },
  });
  const carol = chatWith(nextId(), 'Carol');
  const dave = chatWith(nextId(), 'Dave');
  const message = makeMessage({ seq: 1, content: { type: 'text', text: 'pass it on' } });

  beforeEach(() => {
    useChatStore.setState({
      conversations: { [carol.id]: carol, [dave.id]: dave, [CONV]: makeConversation() },
    });
    useOutboxStore.setState({ items: [], ready: false });
  });

  it('is closed without a message', () => {
    render(<ForwardModal message={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists chats, filters by name, and Send is disabled until one is picked', async () => {
    const user = userEvent.setup();
    render(<ForwardModal message={message} onClose={vi.fn()} />);
    const list = screen.getByRole('list', { name: 'Chats' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'car');
    expect(within(list).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(list).getByText('Carol')).toBeInTheDocument();
  });

  it('sends one forwarded copy to each picked chat, says so and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ForwardModal message={message} onClose={onClose} />);
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dave' }));
    expect(screen.getByRole('button', { name: 'Send (2)' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Send (2)' }));
    const items = useOutboxStore.getState().items;
    expect(items.map((i) => i.conversation_id).sort()).toEqual([carol.id, dave.id].sort());
    expect(items.every((i) => i.content.type === 'text' && i.content.forwarded === true)).toBe(
      true,
    );
    expect(notify.success).toHaveBeenCalledWith('Messages forwarded.');
    expect(onClose).toHaveBeenCalled();
  });

  it('unticking removes a chat from the picks', async () => {
    const user = userEvent.setup();
    render(<ForwardModal message={message} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }));
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('a message that cannot be forwarded sends nothing and says so', async () => {
    const user = userEvent.setup();
    const poll = makeMessage({
      seq: 2,
      content: { type: 'poll', question: 'q?', options: ['a', 'b'], allow_multiple: false },
    });
    render(<ForwardModal message={poll} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }));
    await user.click(screen.getByRole('button', { name: 'Send (1)' }));
    expect(useOutboxStore.getState().items).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith("This kind of message can't be forwarded.");
  });

  it('Cancel closes and forgets the picks', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ForwardModal message={message} onClose={onClose} />);
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    render(<ForwardModal message={message} onClose={vi.fn()} />);
    await expectNoA11yViolations();
  });
});

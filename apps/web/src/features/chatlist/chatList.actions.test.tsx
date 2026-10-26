// The chat list cards, their menu, delete confirmation, archive + undo and select mode.
import { RouterWrapper } from '../../../test/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../test/fakes';
import { expectNoA11yViolations } from '../../../test/a11y';
import { Sidebar } from '../chat/components/Sidebar';
import { useChatStore } from '../chat/useChatStore';
import { useDraftStore } from '../organise/drafts';
import { useOpenRow } from './useOpenRow';
import { useSelection } from './useSelection';

let api: FakeApi;
const chat = (name: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  ...makeConversation({ id: nextId(), ...over }),
  peer: {
    id: nextId(),
    username: name.toLowerCase(),
    display_name: name,
    avatar_url: null,
    is_bot: false,
  },
  ...over,
});
const load = (...chats: ConversationSummary[]) =>
  useChatStore.setState({
    listStatus: 'ready',
    conversations: Object.fromEntries(chats.map((c) => [c.id, c])),
  });
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  screen.getByRole('option', { name: new RegExp(name) }).focus();
  await user.keyboard('{Shift>}{F10}{/Shift}');
  return screen.getByRole('menu', { name: `Options for chat with ${name}` });
};
const swipe = (row: HTMLElement, from: number, to: number) => {
  Object.defineProperty(row, 'offsetWidth', { value: 400 });
  row.setPointerCapture = vi.fn();
  const at = (x: number, y: number) => ({
    pointerId: 1,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    button: 0,
  });
  fireEvent.pointerDown(row, at(from, 10));
  fireEvent.pointerMove(row, at(to, 12));
  fireEvent.pointerUp(row, at(to, 12));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  api.call.mockResolvedValue({ items: [], next_cursor: null });
  useChatStore.getState().reset();
  useDraftStore.setState({ drafts: {} });
  useOpenRow.getState().close();
  useSelection.getState().end();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

describe('chat card', () => {
  it('shows a draft in the accent colour and the manual-unread dot', () => {
    const bob = chat('Bob', { last_message: makeMessage({ seq: 2 }) });
    const amy = chat('Amy');
    load(bob, { ...amy, prefs: { ...amy.prefs, marked_unread: true } });
    useDraftStore.setState({ drafts: { [bob.id]: 'half a thought' } });
    render(<Sidebar />, { wrapper: RouterWrapper });
    expect(screen.getByText('Draft:')).toHaveClass('text-primary');
    expect(screen.getByText('half a thought')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Marked as unread' })).toBeInTheDocument();
  });

  it('is accessible and has keyboard-reachable actions', async () => {
    load(chat('Bob'));
    const { container } = render(<Sidebar />, { wrapper: RouterWrapper });
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    const menu = await openMenu(user, 'Bob');
    for (const item of [
      'Mark as unread',
      'Pin chat',
      'Mute…',
      'Archive chat',
      'Delete chat',
      'Select',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: item })).toBeInTheDocument();
    }
  });
});

describe('swipe buttons', () => {
  it('a swipe to the left reveals mute, archive and delete named after the chat', () => {
    load(chat('Bob'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    swipe(screen.getByRole('option'), 300, 150);
    expect(useOpenRow.getState().side).toBe('end');
    for (const label of ['Mute chat with Bob', 'Archive chat with Bob', 'Delete chat with Bob']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('a vertical drag does not swipe', () => {
    load(chat('Bob'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    swipe(screen.getByRole('option'), 300, 302); // y moves 2px only: still undecided
    const row = screen.getByRole('option');
    const at = (x: number, y: number) => ({
      pointerId: 2,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: 0,
    });
    fireEvent.pointerDown(row, at(300, 10));
    fireEvent.pointerMove(row, at(302, 80));
    fireEvent.pointerUp(row, at(302, 80));
    expect(useOpenRow.getState().openId).toBeNull();
  });

  it('a long swipe left archives', async () => {
    const bob = chat('Bob');
    load(bob);
    api.call.mockImplementation((ep: unknown, opts: unknown) =>
      Promise.resolve(
        ep === ENDPOINTS.conversations.updatePrefs
          ? { ...bob.prefs, ...(opts as { body?: object }).body }
          : { items: [], next_cursor: null },
      ),
    );
    render(<Sidebar />, { wrapper: RouterWrapper });
    swipe(screen.getByRole('option'), 380, 100);
    await waitFor(() => {
      expect(useChatStore.getState().conversations[bob.id]?.prefs.archived).toBe(true);
    });
  });
});

describe('delete with confirmation', () => {
  it('asks first, then deletes only after Delete', async () => {
    const user = userEvent.setup();
    const bob = chat('Bob');
    load(bob);
    api.call.mockResolvedValue(undefined);
    render(<Sidebar />, { wrapper: RouterWrapper });
    const menu = await openMenu(user, 'Bob');
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete chat' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this chat?' });
    expect(dialog).toHaveTextContent('the other people keep theirs');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.call).not.toHaveBeenCalledWith(
      ENDPOINTS.conversations.deleteForMe,
      expect.anything(),
    );

    const menu2 = await openMenu(user, 'Bob');
    await user.click(within(menu2).getByRole('menuitem', { name: 'Delete chat' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(useChatStore.getState().conversations[bob.id]).toBeUndefined();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.deleteForMe, {
      params: { conversation_id: bob.id },
    });
  });

  it('a group offers "Leave and delete"', async () => {
    const user = userEvent.setup();
    const g = {
      ...makeConversation({ id: nextId(), type: 'group' }),
      peer: null,
      title: 'Team',
    } as ConversationSummary;
    load(g);
    render(<Sidebar />, { wrapper: RouterWrapper });
    const menu = await openMenu(user, 'Team');
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete chat' }));
    expect(screen.getByRole('button', { name: 'Leave and delete' })).toBeInTheDocument();
  });
});

describe('select mode', () => {
  it('starts from the menu, selects all and shows the count; Escape leaves', async () => {
    const user = userEvent.setup();
    load(chat('Bob'), chat('Amy'));
    render(<Sidebar />, { wrapper: RouterWrapper });
    const menu = await openMenu(user, 'Bob');
    await user.click(within(menu).getByRole('menuitem', { name: 'Select' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Selected chats' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });
  });
});

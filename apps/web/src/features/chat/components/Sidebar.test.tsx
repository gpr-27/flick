import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  BOB,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
} from '../../../../test/fakes';
import { useChatStore } from '../useChatStore';
import { Sidebar } from './Sidebar';

const carolId = nextId();
const carolConv = nextId();

beforeEach(() => {
  installFakeServices();
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

const load = () => {
  const bob = makeConversation({
    unread_count: 3,
    last_message: makeMessage({ seq: 4, content: { type: 'text', text: 'see you soon' } }),
  });
  const carol = makeConversation({
    id: carolConv,
    peer: {
      id: carolId,
      username: 'carol',
      display_name: 'Carol',
      avatar_url: null,
      is_bot: false,
    },
  });
  useChatStore.setState({
    listStatus: 'ready',
    conversations: { [bob.id]: bob, [carol.id]: carol },
    presence: { [carolId]: { online: true, last_seen_at: null } },
  });
  return { bob, carol };
};

describe('Sidebar', () => {
  it('lists conversations with last message, unread badge and presence dot', () => {
    load();
    render(<Sidebar />);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('see you soon')).toBeInTheDocument();
    expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Online' })).toHaveLength(1);
  });

  it('is a keyboard-navigable listbox: arrows move focus, Enter opens the chat', async () => {
    const user = userEvent.setup();
    const { bob } = load();
    render(<Sidebar />);

    await user.click(screen.getByLabelText('Search chats'));
    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(useChatStore.getState().selectedId).toBe(options[0]?.dataset.conversationId);
    expect([bob.id, carolConv]).toContain(useChatStore.getState().selectedId);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('filters by name and shows an empty state', async () => {
    const user = userEvent.setup();
    load();
    render(<Sidebar />);
    await user.type(screen.getByLabelText('Search chats'), 'zed');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('opens the new-chat dialog', async () => {
    const user = userEvent.setup();
    load();
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('dialog', { name: 'New chat' })).toBeInTheDocument();
    expect(BOB).toBeTruthy();
  });
});

// The chat header (calls, presence, group actions), the extra composer buttons (GIF, poll) and
// the pinned-message bar.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { useGroupCallStore } from '@/features/groupcall/useGroupCallStore';
import { PinnedBar } from '@/features/organise/PinnedBar';
import { useJumpStore } from '@/features/organise/jump';
import { usePinsStore } from '@/features/organise/messageActions';
import { createMemoryKv } from '@/lib/idb';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import type { OutboxItem } from '../outbox/outboxMachine';
import { configureOutboxStorage, useOutboxStore } from '../outbox/useOutboxStore';
import { useChatStore } from '../useChatStore';
import { ChatHeader } from './ChatHeader';
import { MessageInput } from './MessageInput';

let api: FakeApi;
const direct = makeConversation();
const group = makeConversation({
  id: nextId(),
  type: 'group',
  title: 'Team',
  peer: null,
  member_count: 3,
  my_role: 'admin',
});

const header = (c: ConversationSummary = direct) =>
  render(
    <MemoryRouter>
      <ChatHeader conversation={c} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ({ api } = installFakeServices());
  api.call.mockResolvedValue({ items: [], next_cursor: null });
  useChatStore.getState().reset();
  useChatStore.setState({ conversations: { [direct.id]: direct, [group.id]: group } });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  useCallStore.getState()._cleanup();
  useGroupCallStore.setState({ status: 'idle' } as never);
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  usePinsStore.setState({ byConversation: {} });
  useJumpStore.setState({ target: null, flashId: null });
});

describe('chat header', () => {
  it('shows the name and presence: online, last seen, nothing', () => {
    useChatStore.setState({ presence: { [BOB]: { online: true, last_seen_at: null } } });
    const { unmount } = header();
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Online' })).toBeInTheDocument();
    unmount();
    useChatStore.setState({ presence: {} });
    header();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('a group shows its member count', () => {
    header(group);
    expect(screen.getByText('3 members')).toBeInTheDocument();
  });

  it.each([
    ['typing', 'typing…'],
    ['recording_voice', 'recording…'],
    ['recording_video', 'recording…'],
    ['uploading', 'sending a file…'],
  ] as const)('%s replaces the subtitle with "%s"', (activity, text) => {
    header();
    act(() => {
      useChatStore.getState().setActivity(CONV, BOB, activity);
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('the voice and video buttons start the right kind of call with the peer', async () => {
    const user = userEvent.setup();
    const initiateCall = vi.fn();
    useCallStore.setState({ initiateCall } as never);
    header();
    await user.click(screen.getByRole('button', { name: 'Start voice call with Bob' }));
    await user.click(screen.getByRole('button', { name: 'Start video call with Bob' }));
    expect(initiateCall).toHaveBeenNthCalledWith(1, CONV, direct.peer, 'audio');
    expect(initiateCall).toHaveBeenNthCalledWith(2, CONV, direct.peer, 'video');
  });

  it('call buttons are disabled during a call', () => {
    useCallStore.setState({ callStatus: 'connected' } as never);
    header();
    expect(screen.getByRole('button', { name: 'Start voice call with Bob' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start video call with Bob' })).toBeDisabled();
  });

  it('a group has no 1:1 call buttons but can start a group call, unless one is going', async () => {
    const user = userEvent.setup();
    const join = vi.fn();
    useGroupCallStore.setState({ join } as never);
    const { unmount } = header(group);
    expect(screen.queryByRole('button', { name: /voice call/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start group call' }));
    expect(join).toHaveBeenCalledWith({ conversation_id: group.id });
    unmount();
    useGroupCallStore.setState({ status: 'connected' } as never);
    header(group);
    expect(screen.getByRole('button', { name: 'Start group call' })).toBeDisabled();
  });

  it('Group info opens the group dialog', async () => {
    const user = userEvent.setup();
    header(group);
    await user.click(screen.getByRole('button', { name: 'Group info' }));
    expect(await screen.findByRole('dialog', { name: 'Group info' })).toBeInTheDocument();
  });

  it('Ask Flick opens the assistant; Search in chat opens search scoped to this chat', async () => {
    const user = userEvent.setup();
    header();
    await user.click(screen.getByRole('button', { name: 'Ask Flick' }));
    expect(await screen.findByRole('dialog', { name: 'Ask Flick' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Search in chat' }));
    await user.type(await screen.findByRole('searchbox'), 'dinner{Enter}');
    await waitFor(() => {
      expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.search, {
        query: { q: 'dinner', conversation_id: CONV },
      });
    });
  });

  it('Close conversation and Back to chats both deselect the chat', async () => {
    const user = userEvent.setup();
    useChatStore.setState({ selectedId: CONV });
    header();
    await user.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(useChatStore.getState().selectedId).toBeNull();
    useChatStore.setState({ selectedId: CONV });
    await user.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(useChatStore.getState().selectedId).toBeNull();
  });

  it('the disappearing-messages button names the current timer and opens the picker with it selected', async () => {
    const user = userEvent.setup();
    header({ ...direct, settings: { ...direct.settings, disappearing_timer_s: 86_400 } });
    await user.click(screen.getByRole('button', { name: 'Disappearing messages: 24 hours' }));
    const group = await screen.findByRole('radiogroup', { name: 'Timer' });
    expect(within(group).getByRole('radio', { name: '24 hours' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Off' })).not.toBeChecked();
  });

  it('has no accessibility violations (direct and group)', async () => {
    const { container, unmount } = header();
    await expectNoA11yViolations(container);
    unmount();
    const g = header(group);
    await expectNoA11yViolations(g.container);
  });
});

describe('extra composer buttons', () => {
  const composer = (c = direct) => render(<MessageInput conversation={c} messages={[]} />);
  const queued = () => useOutboxStore.getState().items;

  it('Create poll opens the poll dialog; sending a poll queues a poll message', async () => {
    const user = userEvent.setup();
    composer();
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create poll' });
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText('Question'), 'Lunch?');
    await user.type(screen.getByLabelText('Option 1'), 'Pizza');
    await user.type(screen.getByLabelText('Option 2'), 'Sushi');
    await user.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(queued()[0]?.content).toMatchObject({
      type: 'poll',
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      allow_multiple: false,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create poll' })).not.toBeInTheDocument();
    });
  });

  it('a poll with one option is refused with a message and nothing is queued', async () => {
    const user = userEvent.setup();
    composer();
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    await user.type(await screen.findByLabelText('Question'), 'Lunch?');
    await user.type(screen.getByLabelText('Option 1'), 'Pizza');
    await user.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least two different options');
    expect(queued()).toEqual([]);
  });

  it('GIFs and stickers toggles the picker', async () => {
    const user = userEvent.setup();
    composer();
    const button = screen.getByRole('button', { name: 'GIFs and stickers' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('a poll sent while replying carries reply_to', async () => {
    const user = userEvent.setup();
    composer();
    const original = makeMessage({ seq: 3, sender_user_id: BOB });
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    await user.click(screen.getByRole('button', { name: 'Create poll' }));
    await user.type(await screen.findByLabelText('Question'), 'Q?');
    await user.type(screen.getByLabelText('Option 1'), 'A');
    await user.type(screen.getByLabelText('Option 2'), 'B');
    await user.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(queued()[0]?.content).toMatchObject({ reply_to: original.message_id });
    expect(useChatStore.getState().replyingTo).toBeNull();
  });
});

describe('pinned bar', () => {
  const pin = (text: string, seq: number) => makeMessage({ seq, content: { type: 'text', text } });

  it('shows the newest pin first and each click jumps to it and moves to the next', async () => {
    const user = userEvent.setup();
    const [a, b] = [pin('first pin', 5), pin('second pin', 3)];
    api.call.mockResolvedValue({ items: [a, b] });
    render(<PinnedBar conversationId={CONV} />);
    const bar = await screen.findByRole('button', { name: /Pinned message 1 of 2: first pin/ });
    expect(screen.getByText('Pinned message (1/2)')).toBeInTheDocument();
    await user.click(bar);
    expect(useJumpStore.getState().target).toMatchObject({ messageId: a.message_id });
    expect(
      await screen.findByRole('button', { name: /Pinned message 2 of 2: second pin/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pinned message 2 of 2/ }));
    expect(useJumpStore.getState().target).toMatchObject({ messageId: b.message_id });
    expect(
      await screen.findByRole('button', { name: /Pinned message 1 of 2/ }),
    ).toBeInTheDocument(); // wraps
  });

  it('a single pin has no counter', async () => {
    api.call.mockResolvedValue({ items: [pin('only', 1)] });
    render(<PinnedBar conversationId={CONV} />);
    expect(await screen.findByText('Pinned message')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    api.call.mockResolvedValue({ items: [pin('only', 1)] });
    const { container } = render(<PinnedBar conversationId={CONV} />);
    await screen.findByText('Pinned message');
    await expectNoA11yViolations(container);
  });
});

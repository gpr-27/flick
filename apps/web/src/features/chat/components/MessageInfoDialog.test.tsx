import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { BOB, CONV, ME, fakeApi, installFakeServices, makeMessage } from '../../../../test/fakes';
import { buildRows } from '../threadRows';
import { useChatStore } from '../useChatStore';
import { MessageBubble } from './MessageBubble';
import { MessageInfoDialog } from './MessageInfoDialog';

const msg = makeMessage({ sender_user_id: ME });
const carol = 'carol-id';
const bob = { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false };
const carolUser = { ...bob, id: carol, username: 'carol', display_name: 'Carol' };

const setup = (info: unknown) => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) => {
    if (endpoint === ENDPOINTS.messages.info)
      return info instanceof Error ? Promise.reject(info) : Promise.resolve(info);
    return Promise.resolve({
      items: [
        { user: bob, role: 'member' },
        { user: carolUser, role: 'member' },
      ],
      next_cursor: null,
    });
  });
  installFakeServices(undefined, api);
  render(<MessageInfoDialog conversationId={CONV} messageId={msg.message_id} onClose={vi.fn()} />);
  return api;
};

describe('MessageInfoDialog', () => {
  beforeEach(() => {
    useChatStore.setState({ members: {}, conversations: {} });
  });

  it('lists who read it and who only got it', async () => {
    const api = setup({
      message_id: msg.message_id,
      recipients: [
        { user_id: BOB, delivered: true, read: true },
        { user_id: carol, delivered: true, read: false },
      ],
    });
    const read = await screen.findByRole('region', { name: 'Read by' });
    expect(within(read).getByText('Bob')).toBeInTheDocument();
    const delivered = screen.getByRole('region', { name: 'Delivered to' });
    expect(within(delivered).getByText('Carol')).toBeInTheDocument();
    expect(within(delivered).queryByText('Bob')).not.toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.info, {
      params: { conversation_id: CONV, message_id: msg.message_id },
    });
  });

  it('shows a spinner while loading, then an empty state', async () => {
    setup({ message_id: msg.message_id, recipients: [] });
    expect(screen.getByRole('status', { name: 'Loading message info' })).toBeInTheDocument();
    expect(await screen.findByText('Nobody else is in this chat.')).toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    const api = setup(new Error('boom'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    api.call.mockImplementation(() =>
      Promise.resolve({
        message_id: msg.message_id,
        recipients: [{ user_id: BOB, delivered: false, read: false }],
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const delivered = await screen.findByRole('region', { name: 'Delivered to' });
    expect(within(delivered).getByText('Nobody yet')).toBeInTheDocument();
  });
});

describe('Message info menu action', () => {
  const open = async (mine: boolean) => {
    const [row] = buildRows([makeMessage({ sender_user_id: mine ? ME : BOB, seq: 3 })], [], CONV);
    const api = fakeApi();
    api.call.mockResolvedValue({ message_id: 'm', recipients: [], items: [] });
    installFakeServices(undefined, api);
    render(
      <MessageBubble
        row={row!}
        myId={ME}
        sender={null}
        isGroup={false}
        status="sent"
        quoted={null}
        quotedName=""
        showDate={false}
        onReact={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        content={{ onOpenImage: vi.fn() }}
        onJumpTo={vi.fn()}
      />,
    );
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText(/message \d+/) });
  };

  it('is offered on my own message and opens the dialog', async () => {
    await open(true);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Message info' }));
    expect(await screen.findByRole('dialog', { name: 'Message info' })).toBeInTheDocument();
  });

  it("is not offered on someone else's message", async () => {
    await open(false);
    expect(screen.queryByRole('menuitem', { name: 'Message info' })).not.toBeInTheDocument();
  });
});

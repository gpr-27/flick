import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FLICK_BOT_USER_ID } from '@chat/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, CONV, installFakeServices, makeMessage } from '../../../../test/fakes';
import { buildRows } from '../threadRows';
import type { OutboxItem } from '../outbox/outboxMachine';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

const props = (overrides: Partial<MessageBubbleProps>): MessageBubbleProps => {
  const [row] = buildRows([makeMessage({ sender_user_id: ME, seq: 3 })], [], CONV);
  return {
    row: row!,
    myId: ME,
    sender: null,
    isGroup: false,
    status: 'sent',
    quoted: null,
    quotedName: '',
    showDate: false,
    onReact: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onDiscard: vi.fn(),
    content: { onOpenImage: vi.fn() },
    onJumpTo: vi.fn(),
    ...overrides,
  };
};

const failedItem = (retryable: boolean): OutboxItem => ({
  client_message_id: 'client_msg_failed',
  conversation_id: CONV,
  user_id: ME,
  content: { type: 'text', text: 'did not go' },
  created_at: 1,
  status: 'failed',
  error: { code: 'X', message: 'Could not send.', retryable },
});

const bubbleText = (): HTMLElement => screen.getByText(/./, { selector: 'p' });

describe('message menu', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens when a finger holds the message, and not on a quick tap', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...props({})} />);

    fireEvent.pointerDown(bubbleText(), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(bubbleText(), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();

    fireEvent.pointerDown(bubbleText(), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument();
  });

  it('does not open when the finger moves, which means scrolling', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...props({})} />);
    fireEvent.pointerDown(bubbleText(), { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubbleText(), { pointerType: 'touch', clientX: 10, clientY: 60 });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();
  });

  it('says Unpin for a pinned message and calls the pin handler', async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();
    const p = props({ pinned: true, onPin });
    render(<MessageBubble {...p} />);
    await user.pointer({ keys: '[MouseRight]', target: bubbleText() });
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Unpin' }));
    expect(onPin).toHaveBeenCalledWith(p.row.message);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reacts, replies and edits from the menu', async () => {
    const user = userEvent.setup();
    const p = props({});
    render(<MessageBubble {...p} />);

    await user.pointer({ keys: '[MouseRight]', target: bubbleText() });
    await user.click(screen.getByRole('button', { name: 'React ❤️' }));
    expect(p.onReact).toHaveBeenCalledWith(p.row.message, '❤️');

    await user.pointer({ keys: '[MouseRight]', target: bubbleText() });
    await user.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(p.onReply).toHaveBeenCalledWith(p.row.message);

    await user.pointer({ keys: '[MouseRight]', target: bubbleText() });
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(p.onEdit).toHaveBeenCalledWith(p.row.message);
  });

  it("shows Report and no Edit or Delete-for-everyone for someone else's message", async () => {
    const user = userEvent.setup();
    const [row] = buildRows([makeMessage({ sender_user_id: 'someone-else', seq: 4 })], [], CONV);
    render(<MessageBubble {...props({ row: row! })} />);
    await user.pointer({ keys: '[MouseRight]', target: bubbleText() });
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete for everyone' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete for me' })).toBeInTheDocument();
  });

  it('has no menu for a message that is still sending', () => {
    const [row] = buildRows([], [{ ...failedItem(true), status: 'pending', error: null }], CONV);
    render(<MessageBubble {...props({ row: row!, status: 'pending' })} />);
    fireEvent.contextMenu(bubbleText());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('MessageBubble', () => {
  it('shows the right tick for each state', () => {
    for (const [status, label] of [
      ['pending', 'Sending'],
      ['sent', 'Sent'],
      ['delivered', 'Delivered'],
      ['read', 'Read'],
    ] as const) {
      const { unmount } = render(<MessageBubble {...props({ status })} />);
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
      unmount();
    }
  });

  it("offers Retry on a retryable failure and calls it with the message's own id", async () => {
    const user = userEvent.setup();
    installFakeServices();
    const [row] = buildRows([], [failedItem(true)], CONV);
    const p = props({ row: row!, status: 'failed' });
    render(<MessageBubble {...p} />);

    expect(screen.getByText('Could not send.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(p.onRetry).toHaveBeenCalledWith('client_msg_failed');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onDiscard).toHaveBeenCalledWith('client_msg_failed');
  });

  it('offers only Discard when the failure is permanent', () => {
    const [row] = buildRows([], [failedItem(false)], CONV);
    render(<MessageBubble {...props({ row: row!, status: 'failed' })} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('shows a tombstone for a message deleted for everyone', () => {
    const [row] = buildRows(
      [makeMessage({ content: null, deleted_at: '2026-01-01T13:00:00.000Z' })],
      [],
      CONV,
    );
    render(<MessageBubble {...props({ row: row! })} />);
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
  });

  it('offers delete for me and, for own messages, delete for everyone', async () => {
    const user = userEvent.setup();
    const p = props({});
    render(<MessageBubble {...p} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText(/./, { selector: 'p' }) });
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete for everyone' }));
    expect(p.onDelete).toHaveBeenCalledWith(p.row.message, 'everyone');
  });

  it('shows which model wrote an @flick reply, and not on a human message', () => {
    installFakeServices();
    const botRow = buildRows(
      [
        makeMessage({
          sender_user_id: FLICK_BOT_USER_ID,
          seq: 5,
          content: {
            type: 'text',
            text: 'Dinner is at 8.',
            ai_provider: 'anthropic',
            ai_model: 'claude-haiku-5-5',
          },
        }),
      ],
      [],
      CONV,
    )[0]!;
    const { unmount } = render(<MessageBubble {...props({ row: botRow })} />);
    expect(screen.getByText('Answered by Anthropic · claude-haiku-5-5')).toBeInTheDocument();
    unmount();

    // A person cannot pass themselves off as the AI: the label only shows for the bot.
    const humanRow = buildRows(
      [
        makeMessage({
          sender_user_id: ME,
          seq: 6,
          content: {
            type: 'text',
            text: 'hi',
            ai_provider: 'anthropic',
            ai_model: 'claude-haiku-5-5',
          },
        }),
      ],
      [],
      CONV,
    )[0]!;
    render(<MessageBubble {...props({ row: humanRow })} />);
    expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument();
  });

  it('falls back to a plain line for a content type this version cannot draw', () => {
    const [row] = buildRows(
      // A type a newer server might send; this client version does not know it.
      [makeMessage({ content: { type: 'hologram', depth: 3 } as never })],
      [],
      CONV,
    );
    render(<MessageBubble {...props({ row: row! })} />);
    expect(screen.getByText(/not supported/)).toBeInTheDocument();
  });
});

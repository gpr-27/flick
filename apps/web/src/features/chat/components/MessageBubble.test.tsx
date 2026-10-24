import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    pickerOpen: false,
    onTogglePicker: vi.fn(),
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
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete for everyone' }));
    expect(p.onDelete).toHaveBeenCalledWith(p.row.message, 'everyone');
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

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageRecord } from '@chat/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ME, CONV, makeMessage } from '../../../../test/fakes';
import { buildRows, groupAlbums } from '../threadRows';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';

vi.mock('../content/attachments', () => ({
  useAttachmentUrl: (id: string) => ({ url: `blob:${id}`, failed: false, fail: vi.fn() }),
  getAttachmentUrl: vi.fn(),
  refreshAttachmentUrl: vi.fn(),
}));

const ALBUM = '0190a0a0-0000-7000-8000-0000000000aa';
const item = (n: number, index: number, count: number, caption?: string): MessageRecord =>
  makeMessage({
    message_id: `m${String(n)}`,
    seq: n,
    sender_user_id: ME,
    content: {
      type: 'image',
      attachment_id: `att${String(n)}`,
      width: 100,
      height: 100,
      album: { id: ALBUM, index, count },
      ...(caption ? { caption } : {}),
    },
  });

const albumProps = (messages: MessageRecord[], overrides: Partial<MessageBubbleProps> = {}) => {
  const [row] = groupAlbums(buildRows(messages, [], CONV));
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
  } satisfies MessageBubbleProps;
};

describe('album bubble', () => {
  it('draws the items in one bubble with the caption and time once', () => {
    render(
      <MessageBubble {...albumProps([item(1, 0, 3, 'Beach day'), item(2, 1, 3), item(3, 2, 3)])} />,
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const grid = screen.getByRole('group', { name: '3 photos' });
    expect(within(grid).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByText('Beach day')).toHaveLength(1);
    expect(document.querySelectorAll('time')).toHaveLength(1);
  });

  it('opens the viewer at the tapped item', async () => {
    const onOpenImage = vi.fn();
    render(
      <MessageBubble
        {...albumProps([item(1, 0, 3), item(2, 1, 3), item(3, 2, 3)], {
          content: { onOpenImage },
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open photo 2 of 3' }));
    expect(onOpenImage).toHaveBeenCalledWith('att2');
  });

  it('shows +N on the last tile of a bigger album', () => {
    const messages = Array.from({ length: 7 }, (_, i) => item(i + 1, i, 7));
    render(<MessageBubble {...albumProps(messages)} />);
    expect(screen.getAllByRole('button', { name: /^Open photo/ })).toHaveLength(4);
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('shows a placeholder tile for an item that is missing', () => {
    render(<MessageBubble {...albumProps([item(1, 0, 3), item(3, 2, 3)])} />);
    expect(
      screen.getAllByRole('img', { name: 'This photo or video is not available' }),
    ).toHaveLength(1);
  });

  it('the menu on one tile acts on that item', async () => {
    const onReply = vi.fn();
    const messages = [item(1, 0, 3), item(2, 1, 3), item(3, 2, 3)];
    render(<MessageBubble {...albumProps(messages, { onReply })} />);
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Open photo 2 of 3' }),
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith(messages[1]);
  });

  it('selecting a tile selects that item only', async () => {
    const onSelect = vi.fn();
    const messages = [item(1, 0, 2), item(2, 1, 2)];
    render(
      <MessageBubble
        {...albumProps(messages, { selecting: true, onSelect, selectedIds: ['m1'] })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open photo 2 of 2' }));
    expect(onSelect).toHaveBeenCalledWith(messages[1]);
  });
});

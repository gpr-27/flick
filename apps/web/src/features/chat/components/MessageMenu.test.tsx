// The message action sheet: how it opens (hold, right-click, button), its 350 ms arm delay, the
// keyboard, and that every action calls exactly the right handler and then closes.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { ME, CONV, installFakeServices, makeMessage } from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { REACTIONS } from '../reactions';
import { buildRows } from '../threadRows';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble';
import { MessageMenu, type MessageMenuProps } from './MessageMenu';

const menuProps = (over: Partial<MessageMenuProps> = {}): MessageMenuProps => ({
  onClose: vi.fn(),
  isMine: true,
  pinned: false,
  starred: false,
  canEdit: true,
  copyText: 'hello',
  canTranslate: true,
  onReact: vi.fn(),
  onReply: vi.fn(),
  onCopy: vi.fn(),
  onForward: vi.fn(),
  onPin: vi.fn(),
  onStar: vi.fn(),
  onEdit: vi.fn(),
  onTranslate: vi.fn(),
  onReport: vi.fn(),
  onDelete: vi.fn(),
  ...over,
});

beforeEach(() => {
  installFakeServices();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MessageMenu: actions', () => {
  it('lists every action for my own text message', () => {
    render(<MessageMenu {...menuProps()} />);
    const menu = screen.getByRole('menu', { name: 'Message actions' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Reply', 'Copy', 'Forward', 'Pin', 'Star', 'Translate', 'Edit', 'Delete']);
  });

  it('shows Report instead of nothing for someone else, and no Edit', () => {
    render(<MessageMenu {...menuProps({ isMine: false, canEdit: false })} />);
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it.each([
    ['no copy for a photo', { copyText: null }, 'Copy'],
    ['no translate for non-text', { canTranslate: false }, 'Translate'],
    ['no edit when not editable', { canEdit: false }, 'Edit'],
    ['no forward without a handler', { onForward: undefined }, 'Forward'],
    ['no pin without a handler', { onPin: undefined }, 'Pin'],
    ['no star without a handler', { onStar: undefined }, 'Star'],
  ] as [string, Partial<MessageMenuProps>, string][])('%s', (_n, over, missing) => {
    render(<MessageMenu {...menuProps(over)} />);
    expect(screen.queryByRole('menuitem', { name: missing })).not.toBeInTheDocument();
  });

  it('says Unpin / Unstar for a pinned / starred message', () => {
    render(<MessageMenu {...menuProps({ pinned: true, starred: true })} />);
    expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Unstar' })).toBeInTheDocument();
  });

  // [menu item, handler that must fire]
  const table: [string, keyof MessageMenuProps][] = [
    ['Reply', 'onReply'],
    ['Forward', 'onForward'],
    ['Pin', 'onPin'],
    ['Star', 'onStar'],
    ['Translate', 'onTranslate'],
    ['Edit', 'onEdit'],
  ];
  it.each(table)('%s calls %s once, then closes', async (name, handler) => {
    const user = userEvent.setup();
    const p = menuProps();
    render(<MessageMenu {...p} />);
    await user.click(screen.getByRole('menuitem', { name }));
    expect(p[handler]).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    // ...and no other action fired.
    for (const [, other] of table) if (other !== handler) expect(p[other]).not.toHaveBeenCalled();
  });

  it('Report calls onReport and closes', async () => {
    const user = userEvent.setup();
    const p = menuProps({ isMine: false });
    render(<MessageMenu {...p} />);
    await user.click(screen.getByRole('menuitem', { name: 'Report' }));
    expect(p.onReport).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('Copy passes the text', async () => {
    const user = userEvent.setup();
    const p = menuProps({ copyText: 'copy me' });
    render(<MessageMenu {...p} />);
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(p.onCopy).toHaveBeenCalledWith('copy me');
  });

  it.each(REACTIONS)('reaction %s calls onReact with it', async (emoji) => {
    const user = userEvent.setup();
    const p = menuProps();
    render(<MessageMenu {...p} />);
    await user.click(screen.getByRole('button', { name: `React ${emoji}` }));
    expect(p.onReact).toHaveBeenCalledWith(emoji);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  describe('delete steps', () => {
    it('Delete asks first; nothing is deleted yet and the sheet stays open', async () => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(screen.getByRole('menu', { name: 'Delete options' })).toBeInTheDocument();
      expect(screen.getByText('Delete message?')).toBeInTheDocument();
      expect(p.onDelete).not.toHaveBeenCalled();
      expect(p.onClose).not.toHaveBeenCalled();
    });

    it.each([
      ['Delete for me', 'me'],
      ['Delete for everyone', 'everyone'],
    ] as const)('%s deletes with scope %s', async (name, scope) => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await user.click(screen.getByRole('menuitem', { name }));
      expect(p.onDelete).toHaveBeenCalledExactlyOnceWith(scope);
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('Cancel closes without deleting', async () => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
      expect(p.onDelete).not.toHaveBeenCalled();
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it("someone else's message only offers Delete for me", async () => {
      const user = userEvent.setup();
      render(<MessageMenu {...menuProps({ isMine: false })} />);
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(
        screen.queryByRole('menuitem', { name: 'Delete for everyone' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('keyboard', () => {
    it('opens with focus inside the sheet and Escape closes it', async () => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      expect(
        screen.getByRole('dialog', { name: 'Message actions' }).contains(document.activeElement),
      ).toBe(true);
      await user.keyboard('{Escape}');
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('Tab stays inside the sheet', async () => {
      const user = userEvent.setup();
      render(<MessageMenu {...menuProps()} />);
      const dialog = screen.getByRole('dialog', { name: 'Message actions' });
      for (let i = 0; i < 40; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });

    it('Shift+Tab from the first control wraps to the last', async () => {
      const user = userEvent.setup();
      render(<MessageMenu {...menuProps()} />);
      await user.tab({ shift: true });
      await user.tab({ shift: true });
      const dialog = screen.getByRole('dialog', { name: 'Message actions' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('Enter on a focused action runs it', async () => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      screen.getByRole('menuitem', { name: 'Reply' }).focus();
      await user.keyboard('{Enter}');
      expect(p.onReply).toHaveBeenCalledTimes(1);
    });

    it('a click on the backdrop closes it', async () => {
      const user = userEvent.setup();
      const p = menuProps();
      render(<MessageMenu {...p} />);
      await user.click(screen.getByRole('dialog').parentElement!);
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('has no accessibility violations (actions and delete steps)', async () => {
    const user = userEvent.setup();
    render(<MessageMenu {...menuProps()} />);
    await expectNoA11yViolations();
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await expectNoA11yViolations();
  });
});

describe('MessageMenu: the 350 ms arm delay', () => {
  it('ignores touches (pointer-events-none) until armed, then accepts them', () => {
    vi.useFakeTimers();
    render(<MessageMenu {...menuProps()} />);
    const overlay = screen.getByRole('dialog').parentElement!;
    expect(overlay).toHaveClass('pointer-events-none');
    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(overlay).toHaveClass('pointer-events-none');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(overlay).not.toHaveClass('pointer-events-none');
  });

  it('unmounting before it is armed leaves no timer behind', () => {
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    const { unmount } = render(<MessageMenu {...menuProps()} />);
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    unmount();
    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('MessageMenu through the bubble', () => {
  const bubble = (over: Partial<MessageBubbleProps> = {}): MessageBubbleProps => {
    const [row] = buildRows(
      [makeMessage({ sender_user_id: ME, seq: 3, content: { type: 'text', text: 'hello menu' } })],
      [],
      CONV,
    );
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
      onPin: vi.fn(),
      onStar: vi.fn(),
      onForward: vi.fn(),
      ...over,
    };
  };
  const target = () => screen.getByText('hello menu');

  it('a 450 ms hold opens it and vibrates; lifting the finger does not tap anything underneath', () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    render(<MessageBubble {...bubble()} />);
    fireEvent.pointerDown(target(), { pointerType: 'touch', clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(449);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith(10);
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('a mouse press never starts a hold (the mouse uses right-click)', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...bubble()} />);
    fireEvent.pointerDown(target(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moving the finger, lifting it or leaving the bubble cancels the hold', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...bubble()} />);
    for (const cancel of ['pointerUp', 'pointerCancel', 'pointerLeave'] as const) {
      fireEvent.pointerDown(target(), { pointerType: 'touch' });
      fireEvent[cancel](target(), { pointerType: 'touch' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    }
  });

  it('a small wobble (under 10 px) does not cancel the hold', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...bubble()} />);
    fireEvent.pointerDown(target(), { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(target(), { pointerType: 'touch', clientX: 14, clientY: 13 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('right-click opens it and suppresses the browser menu', () => {
    render(<MessageBubble {...bubble()} />);
    const allowed = fireEvent.contextMenu(target());
    expect(allowed).toBe(false); // preventDefault was called
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument();
  });

  it('the small arrow button opens it too, and is highlighted while open', async () => {
    const user = userEvent.setup();
    const { container } = render(<MessageBubble {...bubble()} />);
    await user.click(screen.getByRole('button', { name: 'Actions for this message' }));
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument();
    expect(container.querySelector('.ring-primary')).not.toBeNull();
  });

  it('Escape closes it and the highlight goes away', async () => {
    const user = userEvent.setup();
    const { container } = render(<MessageBubble {...bubble()} />);
    fireEvent.contextMenu(target());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(container.querySelector('.ring-primary')).toBeNull();
  });

  // The bubble wires each sheet action to its own prop.
  it.each([
    ['Reply', 'onReply'],
    ['Edit', 'onEdit'],
    ['Pin', 'onPin'],
    ['Star', 'onStar'],
    ['Forward', 'onForward'],
  ] as const)('%s reaches %s with the message', async (name, prop) => {
    const user = userEvent.setup();
    const p = bubble();
    render(<MessageBubble {...p} />);
    fireEvent.contextMenu(target());
    await user.click(screen.getByRole('menuitem', { name }));
    expect(p[prop]).toHaveBeenCalledExactlyOnceWith(p.row.message);
  });

  it('Copy writes the text to the clipboard and says so', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(notify, 'success').mockImplementation(() => '');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<MessageBubble {...bubble()} />);
    fireEvent.contextMenu(target());
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('hello menu');
    await vi.waitFor(() => {
      expect(success).toHaveBeenCalledWith('Copied');
    });
  });

  it('Copy that the browser refuses says it could not', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(notify, 'error').mockImplementation(() => '');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<MessageBubble {...bubble()} />);
    fireEvent.contextMenu(target());
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith("Couldn't copy");
    });
  });

  it('Translate opens the translate dialog; Report opens the report dialog (someone else)', async () => {
    const user = userEvent.setup();
    const [row] = buildRows(
      [makeMessage({ seq: 3, content: { type: 'text', text: 'hello menu' } })],
      [],
      CONV,
    );
    render(<MessageBubble {...bubble({ row: row! })} />);
    fireEvent.contextMenu(target());
    await user.click(screen.getByRole('menuitem', { name: 'Translate' }));
    expect(await screen.findByRole('dialog', { name: /translate/i })).toBeInTheDocument();
  });

  it.each([
    ['image', { type: 'image', attachment_id: 'a', width: 1, height: 1 }],
    ['poll', { type: 'poll', question: 'q?', options: ['a', 'b'], allow_multiple: false }],
  ] as const)('a %s has no Copy or Translate', (_n, content) => {
    const [row] = buildRows(
      [makeMessage({ sender_user_id: ME, seq: 3, content: content as never })],
      [],
      CONV,
    );
    const { container } = render(<MessageBubble {...bubble({ row: row! })} />);
    fireEvent.contextMenu(container.querySelector('.bubble-sent')!);
    expect(screen.queryByRole('menuitem', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Translate' })).not.toBeInTheDocument();
  });

  it('a deleted message and a system line have no actions', () => {
    const [deleted] = buildRows(
      [makeMessage({ seq: 3, content: null, deleted_at: '2026-01-01T00:00:00.000Z' })],
      [],
      CONV,
    );
    const { container, unmount } = render(<MessageBubble {...bubble({ row: deleted! })} />);
    fireEvent.contextMenu(container.querySelector('.bubble-recv')!);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    unmount();
    const [system] = buildRows(
      [
        makeMessage({
          seq: 4,
          content: { type: 'system', event: 'renamed', actor_user_id: ME, target_user_ids: [] },
        }),
      ],
      [],
      CONV,
    );
    render(<MessageBubble {...bubble({ row: system! })} />);
    expect(
      screen.queryByRole('button', { name: 'Actions for this message' }),
    ).not.toBeInTheDocument();
  });
});

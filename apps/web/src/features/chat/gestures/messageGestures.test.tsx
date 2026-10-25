import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME, CONV, installFakeServices, makeMessage } from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { buildRows } from '../threadRows';
import { MessageBubble, type MessageBubbleProps } from '../components/MessageBubble';

const props = (overrides: Partial<MessageBubbleProps> = {}): MessageBubbleProps => {
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

const bubbleText = (): HTMLElement => screen.getByText(/./, { selector: 'p' });
const bubbleBox = (): HTMLElement => bubbleText().closest('.bubble-sent')!;
const touch = { pointerType: 'touch', pointerId: 1 } as const;

/** A finger that goes down, moves through the given points and lifts at the last one. */
const drag = (target: HTMLElement, points: [number, number][], lift = true): void => {
  const [first, ...rest] = points;
  fireEvent.pointerDown(target, { ...touch, clientX: first![0], clientY: first![1] });
  for (const [x, y] of rest) fireEvent.pointerMove(target, { ...touch, clientX: x, clientY: y });
  const last = points[points.length - 1]!;
  if (lift) fireEvent.pointerUp(target, { ...touch, clientX: last[0], clientY: last[1] });
};

const vibrate = vi.fn();
beforeEach(() => {
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vibrate.mockClear();
});

describe('swipe to reply', () => {
  it('replies when the bubble is dragged right past the threshold, with a light buzz', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [10, 10],
      [30, 12],
      [70, 12],
    ]);
    expect(p.onReply).toHaveBeenCalledWith(p.row.message);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('works the same on a message from someone else', () => {
    const [row] = buildRows([makeMessage({ sender_user_id: 'other', seq: 4 })], [], CONV);
    const p = props({ row: row! });
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [0, 0],
      [20, 0],
      [60, 0],
    ]);
    expect(p.onReply).toHaveBeenCalledWith(p.row.message);
  });

  it('springs back without replying when let go before the threshold', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [10, 10],
      [30, 10],
      [40, 10],
    ]);
    expect(p.onReply).not.toHaveBeenCalled();
    expect(screen.queryByTestId('swipe-reply-arrow')).not.toBeInTheDocument();
  });

  it('shows the arrow while the bubble is being dragged', () => {
    render(<MessageBubble {...props()} />);
    drag(
      bubbleText(),
      [
        [0, 0],
        [20, 0],
        [30, 0],
      ],
      false,
    );
    expect(screen.getByTestId('swipe-reply-arrow')).toBeInTheDocument();
  });

  it('leaves a mostly vertical move to scrolling', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [10, 10],
      [14, 40],
      [80, 60],
    ]);
    expect(p.onReply).not.toHaveBeenCalled();
    expect(screen.queryByTestId('swipe-reply-arrow')).not.toBeInTheDocument();
  });

  it('ignores a drag to the left', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [100, 10],
      [60, 10],
      [10, 10],
    ]);
    expect(p.onReply).not.toHaveBeenCalled();
  });

  it('asks the browser to keep vertical scrolling', () => {
    render(<MessageBubble {...props()} />);
    expect(bubbleBox()).toHaveClass('touch-pan-y');
  });

  it('does not also open the menu: the swipe cancels the hold', () => {
    vi.useFakeTimers();
    render(<MessageBubble {...props()} />);
    drag(
      bubbleText(),
      [
        [0, 0],
        [12, 0],
        [30, 0],
      ],
      false,
    );
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();
  });

  it('still works, without a spring, for people who prefer reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: true, media: query }) as MediaQueryList,
    );
    const p = props();
    render(<MessageBubble {...p} />);
    drag(
      bubbleText(),
      [
        [0, 0],
        [20, 0],
        [30, 0],
      ],
      false,
    );
    expect(bubbleBox().style.transition).toBe('none');
    fireEvent.pointerMove(bubbleText(), { ...touch, clientX: 70, clientY: 0 });
    fireEvent.pointerUp(bubbleText(), { ...touch, clientX: 70, clientY: 0 });
    expect(p.onReply).toHaveBeenCalled();
  });

  it('is ignored on a deleted message', () => {
    const [row] = buildRows(
      [makeMessage({ content: null, deleted_at: '2026-01-01T13:00:00.000Z' })],
      [],
      CONV,
    );
    const p = props({ row: row! });
    render(<MessageBubble {...p} />);
    const tombstone = screen.getByText('This message was deleted');
    drag(tombstone, [
      [0, 0],
      [20, 0],
      [80, 0],
    ]);
    expect(p.onReply).not.toHaveBeenCalled();
  });

  it('is ignored on a message that is still sending', () => {
    const [row] = buildRows(
      [],
      [
        {
          client_message_id: 'c1',
          conversation_id: CONV,
          user_id: ME,
          content: { type: 'text', text: 'on its way' },
          created_at: 1,
          status: 'pending',
          error: null,
        },
      ],
      CONV,
    );
    const p = props({ row: row!, status: 'pending' });
    render(<MessageBubble {...p} />);
    drag(screen.getByText('on its way'), [
      [0, 0],
      [20, 0],
      [80, 0],
    ]);
    expect(p.onReply).not.toHaveBeenCalled();
  });

  it('is ignored on a system line, which has no bubble to drag', () => {
    const [row] = buildRows(
      [
        makeMessage({
          content: {
            type: 'system',
            event: 'member_added',
            actor_user_id: null,
            target_user_ids: [],
          },
        }),
      ],
      [],
      CONV,
    );
    const p = props({ row: row! });
    render(<MessageBubble {...p} />);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reply/i })).not.toBeInTheDocument();
  });

  it('works in a group chat too', () => {
    const [row] = buildRows([makeMessage({ sender_user_id: 'other', seq: 4 })], [], CONV);
    const p = props({
      row: row!,
      isGroup: true,
      sender: { id: 'other', display_name: 'Casey', avatar_url: null } as never,
    });
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [
      [0, 0],
      [20, 0],
      [70, 0],
    ]);
    expect(p.onReply).toHaveBeenCalled();
  });
});

describe('Reply button for laptops and keyboards', () => {
  it('is a real button that replies', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<MessageBubble {...p} />);
    await user.click(screen.getByRole('button', { name: 'Reply to this message' }));
    expect(p.onReply).toHaveBeenCalledWith(p.row.message);
  });
});

describe('double tap or double click to react', () => {
  it('adds a heart on a double tap, with a pop and a buzz', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [[20, 20]]);
    expect(p.onReact).not.toHaveBeenCalled();
    drag(bubbleText(), [[21, 20]]);
    expect(p.onReact).toHaveBeenCalledWith(p.row.message, '❤️');
    expect(screen.getByTestId('heart-pop')).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalled();
  });

  it('is not a double tap when the two taps are far apart', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [[20, 20]]);
    drag(bubbleText(), [[200, 20]]);
    expect(p.onReact).not.toHaveBeenCalled();
  });

  it('toggles: a second double tap on a message I already hearted removes it, with no pop', () => {
    const message = makeMessage({
      sender_user_id: ME,
      seq: 3,
      reactions: [{ emoji: '❤️', user_ids: [ME] }],
    });
    const [row] = buildRows([message], [], CONV);
    const p = props({ row: row! });
    render(<MessageBubble {...p} />);
    drag(bubbleText(), [[20, 20]]);
    drag(bubbleText(), [[20, 20]]);
    expect(p.onReact).toHaveBeenCalledWith(row!.message, '❤️');
    expect(screen.queryByTestId('heart-pop')).not.toBeInTheDocument();
  });

  it('reacts to a double click with the mouse', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    fireEvent.doubleClick(bubbleText());
    expect(p.onReact).toHaveBeenCalledWith(p.row.message, '❤️');
  });

  it('keeps out of the way while the person is selecting text', () => {
    const p = props();
    render(<MessageBubble {...p} />);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'two words',
      removeAllRanges: vi.fn(),
    } as unknown as Selection);
    fireEvent.doubleClick(bubbleText());
    expect(p.onReact).not.toHaveBeenCalled();
  });

  it('does nothing on a deleted message', () => {
    const [row] = buildRows(
      [makeMessage({ content: null, deleted_at: '2026-01-01T13:00:00.000Z' })],
      [],
      CONV,
    );
    const p = props({ row: row! });
    render(<MessageBubble {...p} />);
    fireEvent.doubleClick(screen.getByText('This message was deleted'));
    expect(p.onReact).not.toHaveBeenCalled();
  });
});

describe('holding a link', () => {
  it('offers Copy link and Open instead of the whole menu', () => {
    installFakeServices();
    vi.useFakeTimers();
    const [row] = buildRows(
      [
        makeMessage({
          sender_user_id: ME,
          seq: 3,
          content: { type: 'text', text: 'see https://example.test/page' },
        }),
      ],
      [],
      CONV,
    );
    render(<MessageBubble {...props({ row: row! })} />);
    const link = screen.getByRole('link');
    fireEvent.pointerDown(link, { ...touch, clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const menu = screen.getByRole('menu', { name: 'Link actions' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute(
      'href',
      'https://example.test/page',
    );
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();
  });
});

describe('sheet swipe down', () => {
  it('closes the message actions when dragged down on a phone', () => {
    render(<MessageBubble {...props()} />);
    fireEvent.contextMenu(bubbleText());
    const sheet = screen.getByRole('menu', { name: 'Message actions' }).parentElement!;
    fireEvent.pointerDown(sheet, { ...touch, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(sheet, { ...touch, clientX: 52, clientY: 140 });
    fireEvent.pointerMove(sheet, { ...touch, clientX: 52, clientY: 200 });
    fireEvent.pointerUp(sheet, { ...touch, clientX: 52, clientY: 200 });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument();
  });

  it('stays open on a short drag', () => {
    render(<MessageBubble {...props()} />);
    fireEvent.contextMenu(bubbleText());
    const sheet = screen.getByRole('menu', { name: 'Message actions' }).parentElement!;
    fireEvent.pointerDown(sheet, { ...touch, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(sheet, { ...touch, clientX: 50, clientY: 130 });
    fireEvent.pointerUp(sheet, { ...touch, clientX: 50, clientY: 130 });
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations, including the open menu', async () => {
    const { container } = render(<MessageBubble {...props({ onSelect: vi.fn() })} />);
    await expectNoA11yViolations(container);
    fireEvent.contextMenu(bubbleText());
    await expectNoA11yViolations(document.body);
  });
});

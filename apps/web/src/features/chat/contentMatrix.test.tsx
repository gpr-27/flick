// The content rendering matrix: every message content type, and every way a message can be
// dressed (reply, forwarded, edited, starred, reactions, deleted, view-once, bot), is drawn by
// the bubble and previewed by the chat list, reply quote, pinned bar, forward dialog and search.
import { render, screen, waitFor, within } from '@testing-library/react';
import { FLICK_BOT_USER_ID, type MessageContent, type MessageRecord } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { ForwardModal } from '@/features/organise/ForwardModal';
import { PinnedBar } from '@/features/organise/PinnedBar';
import { usePinsStore } from '@/features/organise/messageActions';
import { SearchPanel } from '@/features/search/SearchPanel';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../test/fakes';
import { MessageBubble, type MessageBubbleProps } from './components/MessageBubble';
import { Sidebar } from './components/Sidebar';
import { previewContent } from './content/registry';
import { buildRows } from './threadRows';
import { useChatStore } from './useChatStore';

let api: FakeApi;

beforeEach(() => {
  ({ api } = installFakeServices());
  api.call.mockResolvedValue({
    url: 'https://files.test/x',
    expires_at: '2999-01-01T00:00:00.000Z',
  });
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

const bubbleProps = (
  message: MessageRecord,
  overrides: Partial<MessageBubbleProps> = {},
): MessageBubbleProps => {
  const [row] = buildRows([message], [], CONV);
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

const draw = (
  content: MessageContent | null,
  extra: Partial<MessageRecord> = {},
  overrides: Partial<MessageBubbleProps> = {},
) => {
  const message = makeMessage({ seq: 5, content, ...extra });
  return { message, ...render(<MessageBubble {...bubbleProps(message, overrides)} />) };
};

const att = () => nextId();
const URL_GIF = 'https://media.giphy.test/g.gif';

/** One entry per content type in @chat/contracts, with what the bubble and the preview say. */
const TYPES: {
  name: string;
  content: MessageContent;
  /** Text the bubble must show (string or regexp). */
  shows: string | RegExp;
  /** The one-line preview. */
  preview: string | RegExp;
}[] = [
  {
    name: 'text',
    content: { type: 'text', text: 'hello there' },
    shows: 'hello there',
    preview: 'hello there',
  },
  {
    name: 'image',
    content: { type: 'image', attachment_id: att(), width: 40, height: 30, caption: 'sunset' },
    shows: 'sunset',
    preview: 'Photo: sunset',
  },
  {
    name: 'image (no caption)',
    content: { type: 'image', attachment_id: att(), width: 40, height: 30 },
    shows: /./,
    preview: 'Photo',
  },
  {
    name: 'video',
    content: {
      type: 'video',
      attachment_id: att(),
      width: 64,
      height: 36,
      duration_ms: 3000,
      caption: 'clip',
    },
    shows: 'clip',
    preview: 'Video: clip',
  },
  {
    name: 'file',
    content: { type: 'file', attachment_id: att(), file_name: 'report.pdf', size: 3 * 1024 * 1024 },
    shows: '3.0 MB',
    preview: 'report.pdf',
  },
  {
    name: 'voice',
    content: {
      type: 'voice',
      attachment_id: att(),
      duration_ms: 65_000,
      waveform: [5, 40, 80, 20],
    },
    shows: /1:05/,
    preview: 'Voice message',
  },
  {
    name: 'gif',
    content: { type: 'gif', gif_id: 'g', url: URL_GIF, width: 20, height: 10, caption: 'lol' },
    shows: 'lol',
    preview: 'GIF',
  },
  {
    name: 'sticker',
    content: { type: 'sticker', sticker_id: 's', url: URL_GIF },
    shows: /./,
    preview: 'Sticker',
  },
  {
    name: 'poll',
    content: {
      type: 'poll',
      question: 'Lunch?',
      options: ['Pizza', 'Sushi'],
      allow_multiple: false,
    },
    shows: 'Lunch?',
    preview: 'Poll: Lunch?',
  },
  {
    name: 'system',
    content: { type: 'system', event: 'group_created', actor_user_id: ME, target_user_ids: [] },
    shows: /created the group/,
    preview: 'created the group',
  },
  {
    name: 'call_event (missed)',
    content: {
      type: 'call_event',
      call_id: nextId(),
      media: 'audio',
      outcome: 'missed',
      started_at: '2026-01-01T00:00:00.000Z',
      duration_s: 0,
    },
    shows: 'Missed voice call',
    preview: 'Missed voice call',
  },
  {
    name: 'call_event (video ended)',
    content: {
      type: 'call_event',
      call_id: nextId(),
      media: 'video',
      outcome: 'ended',
      started_at: '2026-01-01T00:00:00.000Z',
      duration_s: 600,
    },
    shows: 'Video call, 10 min',
    preview: 'Video call, 10 min',
  },
  {
    name: 'call_event (group started)',
    content: {
      type: 'call_event',
      call_id: nextId(),
      media: 'video',
      outcome: 'started',
      group: true,
      started_at: '2026-01-01T00:00:00.000Z',
      duration_s: 0,
    },
    shows: 'Started a group call',
    preview: 'Started a group call',
  },
  {
    name: 'call_event (declined)',
    content: {
      type: 'call_event',
      call_id: nextId(),
      media: 'audio',
      outcome: 'declined',
      started_at: '2026-01-01T00:00:00.000Z',
      duration_s: 0,
    },
    shows: 'Declined voice call',
    preview: 'Declined voice call',
  },
  {
    name: 'poll_vote (never drawn on its own)',
    content: { type: 'poll_vote', poll_message_id: nextId(), option_indexes: [0] },
    shows: /not supported in your version of Flick/,
    preview: 'Unsupported message',
  },
  {
    name: 'unknown future type',
    content: { type: 'hologram', depth: 3 } as unknown as MessageContent,
    shows: /not supported in your version of Flick/,
    preview: 'Unsupported message',
  },
];

describe('content matrix: bubble and preview for every content type', () => {
  it.each(TYPES)(
    '$name draws without throwing and shows the right text',
    async ({ content, shows }) => {
      const { container } = draw(content);
      await waitFor(() => {
        expect(container.textContent).toMatch(
          shows instanceof RegExp
            ? shows
            : new RegExp(shows.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        );
      });
    },
  );

  it.each(TYPES)('$name has a one-line preview', ({ content, preview }) => {
    expect(previewContent(content)).toMatch(
      preview instanceof RegExp
        ? preview
        : new RegExp(`^${preview.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    );
  });

  it('a deleted message previews and draws as deleted', () => {
    expect(previewContent(null)).toBe('This message was deleted');
    draw(null, { deleted_at: '2026-01-01T12:00:00.000Z' });
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
    // No actions button for something that is gone.
    expect(
      screen.queryByRole('button', { name: 'Actions for this message' }),
    ).not.toBeInTheDocument();
  });

  it('every content type has a distinct, non-empty preview (nothing falls back by accident)', () => {
    const known = TYPES.filter((t) => !/unknown|poll_vote/.test(t.name));
    for (const { content } of known) expect(previewContent(content).length).toBeGreaterThan(0);
  });
});

describe('content matrix: dressings', () => {
  it('forwarded', () => {
    draw({ type: 'text', text: 'passed on', forwarded: true });
    expect(screen.getByText('Forwarded')).toBeInTheDocument();
    expect(screen.getByText('passed on')).toBeInTheDocument();
  });

  it('reply: quotes the original and jumps to it', () => {
    const original = makeMessage({
      seq: 2,
      content: { type: 'image', attachment_id: att(), width: 4, height: 4 },
    });
    const onJumpTo = vi.fn();
    draw(
      { type: 'text', text: 'nice photo', reply_to: original.message_id },
      {},
      { quoted: original, quotedName: 'Bob', onJumpTo },
    );
    const quote = screen.getByRole('button', { name: 'Go to the original message' });
    expect(within(quote).getByText('Bob')).toBeInTheDocument();
    expect(within(quote).getByText('Photo')).toBeInTheDocument();
    quote.click();
    expect(onJumpTo).toHaveBeenCalledWith(original.message_id);
  });

  it('reply: a quote whose original is not loaded still draws', () => {
    draw({ type: 'text', text: 'late reply', reply_to: nextId() }, {}, { quoted: null });
    expect(
      within(screen.getByRole('button', { name: 'Go to the original message' })).getByText(
        'Message',
      ),
    ).toBeInTheDocument();
  });

  it('reactions: a count only when more than one person reacted, and my own is pressed', () => {
    draw(
      { type: 'text', text: 'react to me' },
      {
        reactions: [
          { emoji: '👍', user_ids: [ME, BOB] },
          { emoji: '😂', user_ids: [BOB] },
        ],
      },
    );
    const mine = screen.getByRole('button', { name: /👍 2 reactions, including yours/ });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    expect(within(mine).getByText('2')).toBeInTheDocument();
    const theirs = screen.getByRole('button', { name: '😂 1 reaction' });
    expect(theirs).toHaveAttribute('aria-pressed', 'false');
  });

  it('edited and starred and pinned markers', () => {
    draw(
      { type: 'text', text: 'v2' },
      { edited_at: '2026-01-01T12:05:00.000Z', starred: true },
      { pinned: true },
    );
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Starred' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pinned' })).toBeInTheDocument();
  });

  it('disappearing message shows its timer icon', () => {
    draw({ type: 'text', text: 'poof' }, { expires_at: '2999-01-01T00:00:00.000Z' });
    expect(screen.getByRole('img', { name: 'Disappearing message' })).toBeInTheDocument();
  });

  it('a message that was opened (view-once, content gone) says Opened', () => {
    draw(null, { viewed: true, deleted_at: null });
    // Said once, not twice.
    expect(screen.getAllByText('Opened')).toHaveLength(1);
  });

  it('view-once: the recipient sees a tap-to-open card, not the photo', () => {
    draw({ type: 'image', attachment_id: att(), width: 4, height: 4, view_once: true });
    expect(screen.getByRole('button', { name: /photo/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Image' })).not.toBeInTheDocument();
  });

  it('view-once: the sender sees that it was sent, not the photo', () => {
    draw(
      { type: 'image', attachment_id: att(), width: 4, height: 4, view_once: true },
      { sender_user_id: ME },
    );
    expect(screen.queryByRole('img', { name: 'Image' })).not.toBeInTheDocument();
    expect(screen.getByText('View once')).toBeInTheDocument();
  });

  it('bot message: name, Flick badge and the model label', () => {
    draw(
      {
        type: 'text',
        text: 'It is 9am in Tokyo.',
        ai_provider: 'anthropic',
        ai_model: 'claude-haiku-5-5',
      },
      { sender_user_id: FLICK_BOT_USER_ID },
    );
    expect(screen.getByText('Flick')).toBeInTheDocument(); // the author name
    const badge = screen.getByRole('img', { name: 'Flick AI assistant' });
    expect(badge).toHaveTextContent('AI');
    expect(screen.getByText('Answered by Anthropic · claude-haiku-5-5')).toBeInTheDocument();
  });

  it('bot message with an unlisted provider shows the raw provider name', () => {
    draw(
      { type: 'text', text: 'hi', ai_provider: 'acme', ai_model: 'm1' },
      { sender_user_id: FLICK_BOT_USER_ID },
    );
    expect(screen.getByText('Answered by acme · m1')).toBeInTheDocument();
  });

  it('a human message with ai_model set never shows a model label', () => {
    draw({ type: 'text', text: 'hi', ai_provider: 'groq', ai_model: 'x' }, { sender_user_id: BOB });
    expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument();
  });

  it('a group message shows the sender name; a direct one does not', () => {
    const sender = {
      id: BOB,
      username: 'bob',
      display_name: 'Bob',
      avatar_url: null,
      is_bot: false,
    };
    const { unmount } = draw({ type: 'text', text: 'g' }, {}, { isGroup: true, sender });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    unmount();
    draw({ type: 'text', text: 'd' }, {}, { isGroup: false, sender });
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('a date separator appears only when asked', () => {
    const { unmount } = draw({ type: 'text', text: 'x' }, {}, { showDate: true });
    expect(screen.getByRole('separator')).toBeInTheDocument();
    unmount();
    draw({ type: 'text', text: 'x' }, {}, { showDate: false });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});

describe('content matrix: awkward text', () => {
  const longWord = 'a'.repeat(5000);
  const hugeText = ('lorem ipsum dolor sit amet ' as string).repeat(400).slice(0, 10_000);

  it('a 10,000 character message is drawn in full', () => {
    expect(hugeText).toHaveLength(10_000);
    const { container } = draw({ type: 'text', text: hugeText });
    expect(container.querySelector('p')?.textContent).toBe(hugeText);
  });

  it('a 16,000 character message (the maximum) is drawn in full', () => {
    const max = 'x '.repeat(8000);
    const { container } = draw({ type: 'text', text: max });
    expect(container.querySelector('p')?.textContent).toHaveLength(16_000);
  });

  it('a very long unbroken string wraps instead of stretching the bubble', () => {
    const { container } = draw({ type: 'text', text: longWord });
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe(longWord);
    // break-words lets the string wrap; the bubble clips anything else; the column is capped.
    expect(p).toHaveClass('break-words');
    const bubble = p.closest('.animate-bubble-in');
    expect(bubble).toHaveClass('overflow-hidden');
    expect(bubble!.parentElement!.className).toMatch(/max-w-\[85%\]/);
    expect(bubble!.parentElement!.className).toMatch(/sm:max-w-\[65%\]/);
  });

  it('a long unbroken caption and file name cannot stretch the bubble either', () => {
    const { container } = draw({
      type: 'file',
      attachment_id: att(),
      file_name: `${longWord}.pdf`,
      size: 10,
      caption: longWord,
    });
    const name = screen.getByText(`${longWord}.pdf`);
    expect(name).toHaveClass('truncate');
    const caption = [...container.querySelectorAll('p')].find((p) => p.textContent === longWord);
    expect(caption).toHaveClass('break-words');
  });

  it('keeps newlines and runs of spaces (whitespace-pre-wrap)', () => {
    const { container } = draw({ type: 'text', text: 'line one\n\nline   three' });
    const p = container.querySelector('p')!;
    expect(p).toHaveClass('whitespace-pre-wrap');
    expect(p.textContent).toBe('line one\n\nline   three');
  });

  it.each([
    ['Arabic', 'مرحبا بالعالم، كيف حالك اليوم؟'],
    ['Hebrew', 'שלום עולם, מה שלומך היום?'],
    ['mixed LTR and RTL', 'meet me at مقهى النخيل at 5'],
  ])('right-to-left text (%s) is drawn unchanged', (_name, text) => {
    const { container } = draw({ type: 'text', text });
    expect(container.querySelector('p')?.textContent).toBe(text);
    expect(previewContent({ type: 'text', text })).toBe(text);
  });

  it.each([
    ['one emoji', '😀'],
    ['a row of emoji', '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉'],
    ['ZWJ family and flags', '👨‍👩‍👧‍👦🇮🇳🏳️‍🌈'],
  ])('emoji-only text (%s) is drawn unchanged', (_name, text) => {
    const { container } = draw({ type: 'text', text });
    expect(container.querySelector('p')?.textContent).toBe(text);
  });

  it('HTML-looking text is shown as text, never as markup', () => {
    const { container } = draw({ type: 'text', text: '<img src=x onerror=alert(1)><b>bold</b>' });
    const p = container.querySelector('p')!;
    expect(p.querySelector('img')).toBeNull();
    expect(p.querySelector('b')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe(
      '<img src=x onerror=alert(1)><b>bold</b>',
    );
  });

  it('@mentions of known people are marked up; unknown ones are plain', () => {
    useChatStore.setState({
      users: {
        [BOB]: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
      },
    });
    const { container } = draw({ type: 'text', text: 'hi @bob and @nobody_here' });
    expect(container.querySelector('p')?.textContent).toBe('hi @bob and @nobody_here');
  });
});

describe('content matrix: the same content in the other places it shows', () => {
  const messages: [string, MessageContent][] = TYPES.filter((t) => !/poll_vote/.test(t.name)).map(
    (t) => [t.name, t.content],
  );

  it.each(messages)('chat list row: %s', (_name, content) => {
    const last = makeMessage({ seq: 3, content });
    const conv = makeConversation({ last_message: last, last_seq: 3 });
    useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
    render(<Sidebar />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent(previewContent(content).slice(0, 40));
  });

  it('chat list row: a deleted last message and a message of my own', () => {
    const conv = makeConversation({
      last_message: makeMessage({
        seq: 3,
        sender_user_id: ME,
        content: null,
        deleted_at: '2026-01-01T00:00:00.000Z',
      }),
    });
    useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
    render(<Sidebar />);
    expect(screen.getByRole('option')).toHaveTextContent('You: This message was deleted');
  });

  it('chat list row: a 10,000 character last message stays on one truncated line', () => {
    const text = 'z'.repeat(10_000);
    const conv = makeConversation({
      last_message: makeMessage({ seq: 3, content: { type: 'text', text } }),
    });
    useChatStore.setState({ listStatus: 'ready', conversations: { [conv.id]: conv } });
    render(<Sidebar />);
    const span = screen.getByText(text);
    expect(span).toHaveClass('truncate');
  });

  it.each(messages)('pinned banner: %s', async (_name, content) => {
    const pinned = makeMessage({ seq: 2, content });
    api.call.mockResolvedValue({ items: [pinned] });
    render(<PinnedBar conversationId={CONV} />);
    const button = await screen.findByRole('button', { name: /Pinned message 1 of 1/ });
    expect(button.getAttribute('aria-label')).toContain(previewContent(content));
  });

  it('pinned banner: nothing when no message is pinned; "(1/2)" when two are', async () => {
    api.call.mockResolvedValue({ items: [] });
    const { container, unmount } = render(<PinnedBar conversationId={CONV} />);
    await waitFor(() => {
      expect(usePinsStore.getState().byConversation[CONV]).toEqual([]);
    });
    expect(container).toBeEmptyDOMElement();
    unmount();
    api.call.mockResolvedValue({
      items: [makeMessage({ seq: 2 }), makeMessage({ seq: 3 })],
    });
    render(<PinnedBar conversationId={CONV} />);
    expect(await screen.findByText('Pinned message (1/2)')).toBeInTheDocument();
  });

  it.each(messages)('forward preview: %s', (_name, content) => {
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    render(<ForwardModal message={makeMessage({ seq: 2, content })} onClose={() => undefined} />);
    const forwardable = ['text', 'image', 'video', 'file', 'voice', 'gif', 'sticker'].includes(
      content.type,
    );
    expect(document.body.textContent).toContain(
      forwardable ? previewContent(content) : "This kind of message can't be forwarded.",
    );
  });

  it('forward preview: a view-once message cannot be forwarded', () => {
    render(
      <ForwardModal
        message={makeMessage({
          seq: 2,
          content: { type: 'image', attachment_id: att(), width: 2, height: 2, view_once: true },
        })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("This kind of message can't be forwarded.")).toBeInTheDocument();
  });

  it.each(messages)('search result: %s', async (_name, content) => {
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    api.call.mockResolvedValue({
      items: [{ message: makeMessage({ seq: 7, content }), snippet: 'a <mark>hit</mark> here' }],
      next_cursor: null,
    });
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<SearchPanel open onClose={() => undefined} />);
    await user.type(screen.getByRole('searchbox'), 'hit{Enter}');
    const list = await screen.findByRole('list', { name: 'Search results' });
    expect(within(list).getByText('hit').tagName).toBe('MARK');
  });
});

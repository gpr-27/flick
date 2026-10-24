import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, type ConversationSummary, type MessageContent } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { renderContent, previewContent } from '@/features/chat/content/registry';
import { useChatStore } from '@/features/chat/useChatStore';
import { ApiError } from '@/lib/api';
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
import { DisappearingMenu } from './DisappearingMenu';
import { GifPicker } from './GifPicker';
import { isExpired, useUnexpired } from './disappearing';
import { PollComposer } from './polls/PollComposer';

let api: FakeApi;
const DOWNLOAD = { url: 'https://files.test/x', expires_at: '2999-01-01T00:00:00.000Z' };

beforeEach(() => {
  ({ api } = installFakeServices());
  api.call.mockResolvedValue(DOWNLOAD);
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

const draw = (content: MessageContent, isMine = false, id = nextId()) =>
  render(
    <>
      {renderContent(content, {
        onOpenImage: vi.fn(),
        message: { id, conversationId: CONV, isMine },
      })}
    </>,
  );

describe('media messages', () => {
  it('video: a player with controls', async () => {
    const { container } = draw({
      type: 'video',
      attachment_id: nextId(),
      width: 640,
      height: 360,
      duration_ms: 5000,
      caption: 'the beach',
    });
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    expect(container.querySelector('video')).toHaveAttribute('controls');
    expect(screen.getByText('the beach')).toBeInTheDocument();
  });

  it('file: a card with the name and the size', () => {
    draw({ type: 'file', attachment_id: nextId(), file_name: 'report.pdf', size: 2_621_440 });
    expect(screen.getByRole('button', { name: 'Download report.pdf' })).toBeInTheDocument();
    expect(screen.getByText('2.5 MB')).toBeInTheDocument();
  });

  it('image: opens the lightbox on click', async () => {
    const user = userEvent.setup();
    const onOpenImage = vi.fn();
    const attachmentId = nextId();
    render(
      <>
        {renderContent(
          { type: 'image', attachment_id: attachmentId, width: 10, height: 10 },
          { onOpenImage },
        )}
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Open image' }));
    expect(onOpenImage).toHaveBeenCalledWith(attachmentId);
  });

  it('gif and sticker: draw the image and have a chat-list preview', () => {
    draw({
      type: 'gif',
      gif_id: 'g1',
      url: 'https://media.giphy.test/g1.gif',
      width: 200,
      height: 100,
    });
    expect(screen.getByRole('img', { name: 'GIF' })).toHaveAttribute(
      'src',
      'https://media.giphy.test/g1.gif',
    );
    draw({ type: 'sticker', sticker_id: 's1', url: 'https://media.giphy.test/s1.webp' });
    expect(screen.getByRole('img', { name: 'Sticker' })).toBeInTheDocument();
    expect(previewContent({ type: 'sticker', sticker_id: 's1', url: 'https://x.test/s' })).toBe(
      'Sticker',
    );
  });
});

describe('GifPicker', () => {
  const items = [
    {
      id: 'g1',
      title: 'dancing cat',
      url: 'https://media.test/g1.gif',
      preview_url: 'https://media.test/g1-small.gif',
      width: 320,
      height: 240,
    },
  ];

  it('shows trending, sends a gif when one is picked', async () => {
    const user = userEvent.setup();
    api.call.mockResolvedValue({ items });
    const onPick = vi.fn();
    render(<GifPicker onPick={onPick} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Send dancing cat' }));
    expect(onPick).toHaveBeenCalledWith({
      type: 'gif',
      gif_id: 'g1',
      url: 'https://media.test/g1.gif',
      width: 320,
      height: 240,
    });
    expect(api.call.mock.calls[0]?.[0]).toMatchObject({ path: '/gifs/trending' });
  });

  it('debounces typing into one search, and asks for stickers on the Stickers tab', async () => {
    const user = userEvent.setup();
    api.call.mockResolvedValue({ items });
    const onPick = vi.fn();
    render(<GifPicker onPick={onPick} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Send dancing cat' });
    api.call.mockClear();

    await user.type(screen.getByRole('searchbox'), 'cat');
    await waitFor(() => {
      expect(api.call).toHaveBeenCalledTimes(1);
    });
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/gifs/search' }),
      expect.objectContaining({ query: { kind: 'gif', q: 'cat' } }),
    );

    await user.click(screen.getByRole('button', { name: 'Stickers' }));
    await user.click(await screen.findByRole('button', { name: 'Send dancing cat' }));
    expect(onPick).toHaveBeenCalledWith({
      type: 'sticker',
      sticker_id: 'g1',
      url: 'https://media.test/g1.gif',
    });
  });

  it.each([
    [503, 'GIFs are not set up on this server.'],
    [429, 'Too many searches. Wait a minute and try again.'],
    [500, "Couldn't load GIFs. Try again."],
  ])('shows a friendly message for HTTP %i', async (status, message) => {
    api.call.mockRejectedValue(new ApiError({ status, code: 'X', message: 'server text' }));
    render(<GifPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('says when nothing matches', async () => {
    api.call.mockResolvedValue({ items: [] });
    render(<GifPicker onPick={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Nothing found.')).toBeInTheDocument();
  });
});

describe('polls', () => {
  const poll = {
    type: 'poll' as const,
    question: 'Lunch?',
    options: ['Pizza', 'Sushi'],
    allow_multiple: false,
  };
  const tally = (votes: Record<number, string[]>) => ({
    message_id: 'm',
    question: 'Lunch?',
    allow_multiple: false,
    options: poll.options.map((text, index) => ({ index, text, voter_ids: votes[index] ?? [] })),
  });

  it('shows the results and lets the user change their vote', async () => {
    const user = userEvent.setup();
    api.call.mockImplementation((endpoint: unknown, args: unknown) => {
      const { path } = endpoint as { path: string };
      if (path.endsWith('/vote')) {
        const picked = (args as { body: { option_indexes: number[] } }).body.option_indexes;
        return Promise.resolve(tally({ [picked[0] ?? 0]: [ME] }));
      }
      return Promise.resolve(tally({ 0: [ME, BOB] }));
    });
    draw(poll, false, 'poll-message');

    const pizza = await screen.findByRole('button', { name: 'Pizza, 2 votes, your choice' });
    expect(pizza).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 voters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sushi, 0 votes' }));
    expect(
      await screen.findByRole('button', { name: 'Sushi, 1 vote, your choice' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pizza, 0 votes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const voteCall = api.call.mock.calls.find((c) =>
      (c[0] as { path: string }).path.endsWith('/vote'),
    );
    expect(voteCall?.[1]).toMatchObject({ body: { option_indexes: [1] } });
  });

  it('tapping your own choice again removes the vote', async () => {
    const user = userEvent.setup();
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        (endpoint as { path: string }).path.endsWith('/vote') ? tally({}) : tally({ 0: [ME] }),
      ),
    );
    draw(poll, false, 'poll-message-2');
    await user.click(await screen.findByRole('button', { name: 'Pizza, 1 vote, your choice' }));
    expect(await screen.findByRole('button', { name: 'Pizza, 0 votes' })).toBeInTheDocument();
    const voteCall = api.call.mock.calls.find((c) =>
      (c[0] as { path: string }).path.endsWith('/vote'),
    );
    expect(voteCall?.[1]).toMatchObject({ body: { option_indexes: [] } });
  });

  it('composer: needs a question and 2 options, caps at 10, builds the poll content', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<PollComposer open onClose={vi.fn()} onCreate={onCreate} />);
    await user.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Question'), 'Where to?');
    await user.type(screen.getByLabelText('Option 1'), 'Beach');
    await user.type(screen.getByLabelText('Option 2'), 'Hills');
    for (let i = 0; i < 12; i++) {
      const add = screen.queryByRole('button', { name: 'Add option' });
      if (add) await user.click(add);
    }
    expect(screen.getAllByLabelText(/^Option \d+$/)).toHaveLength(10);
    await user.click(screen.getByLabelText('Allow multiple answers'));
    await user.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(onCreate).toHaveBeenCalledWith({
      type: 'poll',
      question: 'Where to?',
      options: ['Beach', 'Hills'],
      allow_multiple: true,
    });
  });
});

describe('view once', () => {
  const content: MessageContent = {
    type: 'image',
    attachment_id: 'att-view-once',
    width: 10,
    height: 10,
    view_once: true,
  };

  it('recipient: Tap to view calls the open endpoint, shows the photo, then "Opened"', async () => {
    const user = userEvent.setup();
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.messages.openViewOnce
          ? { message_id: 'm', opened_at: '2026-01-01T00:00:00.000Z' }
          : DOWNLOAD,
      ),
    );
    draw(content, false, 'vo-1');
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); // nothing is loaded before the tap

    await user.click(screen.getByRole('button', { name: 'Tap to view photo' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.openViewOnce, {
      params: { conversation_id: CONV, message_id: 'vo-1' },
    });
    expect(await screen.findByRole('button', { name: 'Open image' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Close, it can't be opened again/ }));
    expect(screen.getByText('Opened')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open image' })).not.toBeInTheDocument();
  });

  it('an already-opened message shows the Opened placeholder', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValue(
      new ApiError({ status: 409, code: 'VIEW_ONCE_ALREADY_OPENED', message: 'opened' }),
    );
    draw(content, false, 'vo-2');
    await user.click(screen.getByRole('button', { name: 'Tap to view photo' }));
    expect(await screen.findByText('Opened')).toBeInTheDocument();
  });

  it('sender: sees the content with a "View once" label and no open button', async () => {
    draw(content, true, 'vo-3');
    expect(screen.getByText('View once')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tap to view/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open image' })).toBeInTheDocument();
  });
});

describe('disappearing messages', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('isExpired compares expires_at with the clock', () => {
    const at = '2026-01-01T00:00:10.000Z';
    expect(isExpired({ expires_at: null }, Date.parse(at))).toBe(false);
    expect(isExpired({ expires_at: at }, Date.parse(at) - 1)).toBe(false);
    expect(isExpired({ expires_at: at }, Date.parse(at))).toBe(true);
  });

  it('hides a row at the moment it expires, without a refresh', () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-01T00:00:00.000Z') });
    const keep = { message: makeMessage({ expires_at: null }) };
    const soon = { message: makeMessage({ expires_at: '2026-01-01T00:00:10.000Z' }) };
    const { result } = renderHook(() => useUnexpired([keep, soon]));
    expect(result.current).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(result.current).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toEqual([keep]);
  });

  it('a message that already expired is never shown', () => {
    const gone = { message: makeMessage({ expires_at: '2020-01-01T00:00:00.000Z' }) };
    const { result } = renderHook(() => useUnexpired([gone]));
    expect(result.current).toEqual([]);
  });

  it('the timer menu saves the chosen timer through the conversation settings', async () => {
    const user = userEvent.setup();
    const conversation: ConversationSummary = makeConversation();
    const updated = {
      ...conversation,
      settings: { ...conversation.settings, disappearing_timer_s: 604_800 },
    };
    useChatStore.getState().reset();
    useChatStore.setState({ conversations: { [conversation.id]: conversation } });
    api.call.mockResolvedValue(updated);

    render(<DisappearingMenu conversation={conversation} />);
    await user.click(screen.getByRole('button', { name: 'Disappearing messages: Off' }));
    await user.click(screen.getByRole('radio', { name: '7 days' }));

    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.update, {
      params: { conversation_id: conversation.id },
      body: { settings: { disappearing_timer_s: 604_800 } },
    });
    await waitFor(() => {
      expect(
        useChatStore.getState().conversations[conversation.id]?.settings.disappearing_timer_s,
      ).toBe(604_800);
    });
  });
});

describe('link previews', () => {
  const textMessage = (text: string) => draw({ type: 'text', text });

  it('renders a compact card with title, description, site and image', async () => {
    api.call.mockResolvedValue({
      url: 'https://example.test/post-1',
      title: 'A great post',
      description: 'About things',
      image_url: 'https://example.test/cover.png',
      site_name: 'Example',
    });
    const { container } = textMessage('read this https://example.test/post-1 please');
    const card = await screen.findByRole('link', { name: 'Link preview: A great post' });
    expect(card).toHaveAttribute('href', 'https://example.test/post-1');
    expect(card).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.test/cover.png');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.media.linkPreview, {
      query: { url: 'https://example.test/post-1' },
    });
  });

  it('shows page text as plain text, never as HTML', async () => {
    api.call.mockResolvedValue({
      url: 'https://example.test/evil',
      title: '<img src=x onerror="alert(1)">Hi',
      description: '<script>alert(2)</script>',
      image_url: null,
      site_name: null,
    });
    const { container } = textMessage('https://example.test/evil');
    expect(await screen.findByText('<img src=x onerror="alert(1)">Hi')).toBeInTheDocument();
    expect(screen.getByText('<script>alert(2)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('message text is plain text too', () => {
    const { container } = textMessage('<b>bold</b> no link here');
    expect(screen.getByText('<b>bold</b> no link here')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows no card when the preview fails (422 or 429)', async () => {
    api.call.mockRejectedValue(new ApiError({ status: 422, code: 'X', message: 'no' }));
    const { container } = textMessage('see https://example.test/broken');
    await waitFor(() => {
      expect(api.call).toHaveBeenCalled();
    });
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('see https://example.test/broken')).toBeInTheDocument();
  });

  it('does not ask for a preview when there is no link', () => {
    textMessage('just words');
    expect(api.call).not.toHaveBeenCalled();
  });
});
